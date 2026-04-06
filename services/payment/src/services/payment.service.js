const crypto = require('crypto');
const querystring = require('querystring');
const { ValidationError, NotFoundError, AppError } = require('../../../../shared/common/errors');
const outbox = require('../../../../shared/outbox');
const EVENT = require('../../../../shared/event-bus/eventTypes');

class PaymentService {
    constructor(paymentRepo, vnpayRepo, pool, eventBus) {
        this.paymentRepo = paymentRepo;
        this.vnpayRepo = vnpayRepo;
        this.pool = pool;
        this.eventBus = eventBus;
    }

    async getPayments(storeId, filters) {
        return await this.paymentRepo.findAll(storeId, filters);
    }
    
    // Core Logic 1: Tạo thanh toán tiền mặt/chuyển khoản (Direct)
    async createDirectPayment(storeId, data) {
        if (data.method === 'vnpay') {
            throw new ValidationError('Use createVNPayUrl for VNPay method');
        }

        // Type safety — reference_id may arrive as string from frontend select
        const referenceId = parseInt(data.reference_id, 10);
        if (isNaN(referenceId)) {
            throw new ValidationError('Invalid reference_id');
        }

        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Insert payment record (including items + delivery_type)
            const { rows } = await client.query(`
                INSERT INTO payment (store_id, amount, method, status, reference_type, reference_id, created_by, notes, items, delivery_type)
                VALUES ($1, $2, $3, 'completed', $4, $5, $6, $7, $8, $9) RETURNING *
            `, [storeId, data.amount, data.method, data.reference_type, referenceId, data.created_by, data.notes,
                JSON.stringify(data.items || []),
                data.deliveryType || 'pickup'
            ]);
            const payment = rows[0];

            // 2. Calculate total paid so far for this reference
            const { rows: paidRows } = await client.query(
                `SELECT COALESCE(SUM(amount), 0) as total_paid FROM payment
                 WHERE reference_id = $1 AND reference_type = $2 AND store_id = $3 AND status = 'completed'`,
                [referenceId, data.reference_type, storeId]
            );
            const totalPaidSoFar = parseFloat(paidRows[0].total_paid);

            // 3. Insert event into outbox (same transaction — atomic!)
            await outbox.insertEvent(client, EVENT.PAYMENT_COMPLETED, {
                paymentId: payment.id,
                orderId: referenceId,
                storeId,
                referenceType: data.reference_type,
                amount: data.amount,
                method: data.method,
                items: data.items || [],
                deliveryType: data.deliveryType || 'pickup',
                totalPaidSoFar
            }, 'payment-service');

            await client.query('COMMIT');
            return payment;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    // Core Logic 2: Tạo link thanh toán VNPay (Pending)
    async createVNPayUrl(storeId, data, ipAddr) {
        const { amount, reference_type, reference_id, notes, created_by } = data;
        
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            
            // 1. Tạo bản ghi payment (pending)
            const payment = await this.paymentRepo.create(storeId, {
                amount,
                method: 'vnpay',
                reference_type,
                reference_id,
                notes,
                created_by
            });
            
            // 2. Build VNPay params (Mock parameters for now)
            const txnRef = `TXN${payment.id}_${Date.now()}`;
            const vnp_Params = {
                vnp_Version: '2.1.0',
                vnp_Command: 'pay',
                vnp_TmnCode: process.env.VNPAY_TMN_CODE || 'DEMOCODE',
                vnp_Amount: amount * 100, // VNPay expects amount * 100
                vnp_CreateDate: new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14),
                vnp_CurrCode: 'VND',
                vnp_IpAddr: ipAddr,
                vnp_Locale: 'vn',
                vnp_OrderInfo: `Thanh toan don hang ${reference_id}`,
                vnp_OrderType: 'other',
                vnp_ReturnUrl: process.env.VNPAY_RETURN_URL || 'http://localhost:3007/api/payments/vnpay/return',
                vnp_TxnRef: txnRef
            };

            // Sign data
            const signData = querystring.stringify(vnp_Params, { encode: false });
            const secretKey = process.env.VNPAY_HASH_SECRET || 'DEMOSECRET';
            const hmac = crypto.createHmac('sha512', secretKey);
            const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');
            vnp_Params['vnp_SecureHash'] = signed;

            const paymentUrl = (process.env.VNPAY_URL || 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html') + '?' + querystring.stringify(vnp_Params, { encode: false });

            // 3. Lưu log giao dịch VNPay
            const vnpayTxn = await this.vnpayRepo.create({
                payment_id: payment.id,
                reference_id: reference_id,
                vnp_txn_ref: txnRef,
                vnp_amount: amount * 100,
                payment_url: paymentUrl
            });

            await client.query('COMMIT');
            return { payment, paymentUrl };

        } catch (error) {
            await client.query('ROLLBACK');
            throw new AppError('Failed to create VNPay session: ' + error.message, 500);
        } finally {
            client.release();
        }
    }

    // Core Logic 3: Xử lý IPN Webhook từ VNPay (Zone 1 Transaction)
    async processVNPayIPN(ipnData) {
        // Validation secure hash omitted for brevity in this MVP
        const secureHash = ipnData.vnp_SecureHash;
        delete ipnData.vnp_SecureHash;
        delete ipnData.vnp_SecureHashType;
        
        // Find transaction
        const txnRef = ipnData.vnp_TxnRef;
        const vnpayTxn = await this.vnpayRepo.findByTxnRef(txnRef);
        
        if (!vnpayTxn) throw new NotFoundError('Transaction not found');
        if (vnpayTxn.ipn_verified) return { RspCode: '02', Message: 'Order already confirmed' }; // VNPay standard response
        
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            
            const isSuccess = ipnData.vnp_ResponseCode === '00';
            
            // 1. Cập nhật VNPay table
            await this.vnpayRepo.completeTransaction(vnpayTxn.id, ipnData, isSuccess);
            
            // 2. Cập nhật bảng Payment chính
            // Note: need to find payment to get storeId if not passed in txn
            const pQuery = 'SELECT store_id FROM payment WHERE id = $1';
            const pRes = await client.query(pQuery, [vnpayTxn.payment_id]);
            const storeId = pRes.rows[0].store_id;

            const finalStatus = isSuccess ? 'completed' : 'failed';
            
            // Note: Reuse repo, but passing client if we had it, or just use tight window
            const queryUpdatePayment = `
                UPDATE payment SET status = $1 WHERE id = $2 AND store_id = $3 RETURNING *
            `;
            const { rows } = await client.query(queryUpdatePayment, [finalStatus, vnpayTxn.payment_id, storeId]);
            const finalPayment = rows[0];

            // Insert event into outbox (same transaction — atomic!)
            if (isSuccess) {
                await outbox.insertEvent(client, EVENT.PAYMENT_COMPLETED, {
                    paymentId: vnpayTxn.payment_id,
                    orderId: finalPayment.reference_id || vnpayTxn.reference_id,
                    storeId,
                    referenceType: 'SaleOrder',
                    amount: finalPayment.amount,
                    method: 'vnpay'
                }, 'payment-service');
            } else {
                await outbox.insertEvent(client, EVENT.PAYMENT_FAILED, {
                    paymentId: vnpayTxn.payment_id,
                    orderId: vnpayTxn.reference_id,
                    storeId,
                    reason: `VNPay response code: ${ipnData.vnp_ResponseCode}`
                }, 'payment-service');
            }

            await client.query('COMMIT');
            
            return { RspCode: '00', Message: 'Confirm Success' };
        } catch (error) {
            await client.query('ROLLBACK');
            throw new AppError(error.message, 500);
        } finally {
            client.release();
        }
    }

    // Saga §4.3: Expire timed-out VNPay payments
    async expireTimedOutPayments(timeoutMinutes = 15) {
        const expired = await this.vnpayRepo.findExpiredPending(timeoutMinutes);
        const results = [];

        for (const txn of expired) {
            try {
                // 1. Mark vnpay transaction as expired
                await this.vnpayRepo.markExpired(txn.id);

                // 2. Mark payment as expired
                await this.paymentRepo.updateStatus(txn.store_id, txn.payment_id, 'expired');

                // 3. Publish timeout event for saga compensation
                if (this.eventBus) {
                    await this.eventBus.publish(EVENT.PAYMENT_TIMEOUT, {
                        paymentId: txn.payment_id,
                        orderId: txn.order_id,
                        storeId: txn.store_id,
                        reason: `VNPay payment timed out after ${timeoutMinutes} minutes`
                    });
                }

                results.push({ paymentId: txn.payment_id, status: 'expired' });
            } catch (err) {
                results.push({ paymentId: txn.payment_id, status: 'error', error: err.message });
            }
        }

        return results;
    }

    // ============================================================
    // CRUD Operations (for admin panel)
    // ============================================================

    /** Create payment as 'pending' (admin panel flow — no outbox event) */
    async createPendingPayment(storeId, data) {
        return await this.paymentRepo.create(storeId, data);
    }

    async getPaymentById(storeId, id) {
        const payment = await this.paymentRepo.findById(storeId, id);
        if (!payment) throw new NotFoundError('Payment not found');
        return payment;
    }

    /**
     * Update a pending payment.
     * If status transitions to 'completed', publish payment.completed via outbox.
     */
    async updatePayment(storeId, id, data) {
        const existing = await this.paymentRepo.findById(storeId, id);
        if (!existing) throw new NotFoundError('Payment not found');
        if (existing.status !== 'pending') {
            throw new ValidationError('Only pending payments can be edited');
        }

        // Status transition: pending → completed → publish event
        if (data.status === 'completed') {
            const client = await this.pool.connect();
            try {
                await client.query('BEGIN');

                const { rows } = await client.query(
                    `UPDATE payment SET status = 'completed' WHERE id = $1 AND store_id = $2 RETURNING *`,
                    [id, storeId]
                );
                const completed = rows[0];

                // Read items from DB (stored when payment was created)
                let storedItems = [];
                try {
                    storedItems = typeof completed.items === 'string'
                        ? JSON.parse(completed.items)
                        : (completed.items || []);
                } catch (e) { storedItems = []; }

                // Calculate total paid so far for this reference
                const { rows: paidRows } = await client.query(
                    `SELECT COALESCE(SUM(amount), 0) as total_paid FROM payment
                     WHERE reference_id = $1 AND reference_type = $2 AND store_id = $3 AND status = 'completed'`,
                    [completed.reference_id, completed.reference_type, storeId]
                );
                const totalPaidSoFar = parseFloat(paidRows[0].total_paid);

                await outbox.insertEvent(client, EVENT.PAYMENT_COMPLETED, {
                    paymentId: completed.id,
                    orderId: parseInt(completed.reference_id, 10),
                    storeId,
                    referenceType: completed.reference_type,
                    amount: completed.amount,
                    method: completed.method,
                    items: storedItems,
                    deliveryType: completed.delivery_type || 'pickup',
                    totalPaidSoFar
                }, 'payment-service');

                await client.query('COMMIT');
                return completed;
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }
        }

        // Regular edit (amount, method, notes) — no event needed
        const updated = await this.paymentRepo.update(storeId, id, data);
        return updated;
    }

    async deletePayment(storeId, id) {
        const deleted = await this.paymentRepo.delete(storeId, id);
        if (!deleted) {
            throw new ValidationError('Payment not found or cannot be deleted (only pending/cancelled)');
        }
        return deleted;
    }

    async refundPayment(storeId, id) {
        const existing = await this.paymentRepo.findById(storeId, id);
        if (!existing) throw new NotFoundError('Payment not found');
        if (existing.status !== 'completed') {
            throw new ValidationError('Only completed payments can be refunded');
        }

        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            const { rows } = await client.query(
                'UPDATE payment SET status = $1 WHERE id = $2 AND store_id = $3 RETURNING *',
                ['refunded', id, storeId]
            );
            const refunded = rows[0];

            // Check if ALL payments for this reference are now refunded
            const { rows: allPayments } = await client.query(
                `SELECT status FROM payment 
                 WHERE reference_id = $1 AND reference_type = $2 AND store_id = $3
                   AND status IN ('completed', 'refunded')`,
                [refunded.reference_id, refunded.reference_type, storeId]
            );
            const allRefunded = allPayments.length > 0 &&
                allPayments.every(p => p.status === 'refunded');

            // Publish refund event (NO items — inventory return is manual)
            await outbox.insertEvent(client, EVENT.PAYMENT_REFUNDED, {
                paymentId: refunded.id,
                orderId: refunded.reference_id,
                storeId,
                referenceType: refunded.reference_type,
                amount: refunded.amount,
                allRefunded
            }, 'payment-service');

            await client.query('COMMIT');
            return refunded;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}

module.exports = PaymentService;
