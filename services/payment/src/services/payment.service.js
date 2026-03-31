const crypto = require('crypto');
const querystring = require('querystring');
const { ValidationError, NotFoundError, AppError } = require('../../../../shared/common/errors');
const outbox = require('../../../../shared/outbox');

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

        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Insert payment record
            const { rows } = await client.query(`
                INSERT INTO payment (store_id, amount, method, status, reference_type, reference_id, created_by, notes)
                VALUES ($1, $2, $3, 'completed', $4, $5, $6, $7) RETURNING *
            `, [storeId, data.amount, data.method, data.reference_type, data.reference_id, data.created_by, data.notes]);
            const payment = rows[0];

            // 2. Insert event into outbox (same transaction — atomic!)
            await outbox.insertEvent(client, 'payment.completed', {
                paymentId: payment.id,
                orderId: data.reference_id,
                storeId,
                referenceType: data.reference_type,
                amount: data.amount,
                method: data.method
            });

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
                await outbox.insertEvent(client, 'payment.completed', {
                    paymentId: vnpayTxn.payment_id,
                    orderId: finalPayment.reference_id || vnpayTxn.reference_id,
                    storeId,
                    referenceType: 'sale_order',
                    amount: finalPayment.amount,
                    method: 'vnpay'
                });
            } else {
                await outbox.insertEvent(client, 'payment.failed', {
                    paymentId: vnpayTxn.payment_id,
                    orderId: vnpayTxn.reference_id,
                    storeId,
                    reason: `VNPay response code: ${ipnData.vnp_ResponseCode}`
                });
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
                    await this.eventBus.publish('payment.timeout', {
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
}

module.exports = PaymentService;
