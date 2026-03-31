const express = require('express');

/**
 * Format DB row (snake_case) → frontend (camelCase)
 * Also generates paymentNumber from ID
 */
function formatPayment(row) {
    if (!row) return null;
    // Map reference_type for frontend compatibility
    let referenceType = row.reference_type;
    if (referenceType === 'SaleOrder') referenceType = 'Order';

    return {
        id: row.id,
        paymentNumber: `PAY-${String(row.id).padStart(4, '0')}`,
        storeId: row.store_id,
        amount: parseFloat(row.amount),
        paymentMethod: row.method,
        status: row.status,
        referenceType,
        referenceId: row.reference_id,
        paymentDate: row.payment_date,
        createdBy: row.created_by,
        notes: row.notes
    };
}

/**
 * Map frontend referenceType → DB reference_type
 */
function toDbReferenceType(frontendType) {
    if (frontendType === 'Order') return 'SaleOrder';
    return frontendType; // PurchaseOrder stays the same
}

function createPaymentRouter(paymentService) {
    const router = express.Router();

    // GET /payments — list all payments
    router.get('/', async (req, res, next) => {
        try {
            const storeId = req.user ? req.user.storeId : 1;
            const filters = {};

            if (req.query.referenceType) {
                filters.referenceType = toDbReferenceType(req.query.referenceType);
            }
            if (req.query.referenceId) {
                filters.referenceId = req.query.referenceId;
            }
            if (req.query.status) {
                filters.status = req.query.status;
            }
            if (req.query.method || req.query.paymentMethod) {
                filters.method = req.query.method || req.query.paymentMethod;
            }

            const payments = await paymentService.getPayments(storeId, filters);
            res.json({
                success: true,
                data: { payments: payments.map(formatPayment) }
            });
        } catch (error) {
            next(error);
        }
    });

    // GET /payments/:id — get single payment
    router.get('/:id', async (req, res, next) => {
        try {
            const storeId = req.user ? req.user.storeId : 1;
            const payment = await paymentService.getPaymentById(storeId, req.params.id);
            res.json({
                success: true,
                data: { payment: formatPayment(payment) }
            });
        } catch (error) {
            next(error);
        }
    });

    // POST /payments/direct — create cash/bank_transfer payment
    router.post('/direct', async (req, res, next) => {
        try {
            const storeId = req.user ? req.user.storeId : 1;
            const data = {
                ...req.body,
                reference_type: req.body.reference_type || toDbReferenceType(req.body.referenceType),
                reference_id: req.body.reference_id || req.body.referenceId,
                method: req.body.method || req.body.paymentMethod,
                created_by: req.user ? req.user.id : 1
            };

            const payment = await paymentService.createDirectPayment(storeId, data);

            res.status(201).json({
                success: true,
                message: 'Direct payment completed successfully',
                data: { payment: formatPayment(payment) }
            });
        } catch (error) {
            next(error);
        }
    });

    // POST /payments — create payment as pending (admin panel flow)
    // For auto-completed payments, use POST /payments/direct
    router.post('/', async (req, res, next) => {
        try {
            const storeId = req.user ? req.user.storeId : 1;
            const method = req.body.method || req.body.paymentMethod || 'cash';

            if (method === 'vnpay') {
                const ipAddr = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
                const data = {
                    amount: req.body.amount,
                    method,
                    reference_type: req.body.reference_type || toDbReferenceType(req.body.referenceType),
                    reference_id: req.body.reference_id || req.body.referenceId,
                    notes: req.body.notes,
                    created_by: req.user ? req.user.id : 1
                };
                const result = await paymentService.createVNPayUrl(storeId, data, ipAddr);
                return res.status(201).json({
                    success: true,
                    message: 'VNPay URL created',
                    data: { payment: formatPayment(result.payment), paymentUrl: result.paymentUrl }
                });
            }

            // Standard admin flow: create as pending
            const payment = await paymentService.createPendingPayment(storeId, {
                amount: req.body.amount,
                method,
                reference_type: req.body.reference_type || toDbReferenceType(req.body.referenceType),
                reference_id: req.body.reference_id || req.body.referenceId,
                notes: req.body.notes,
                created_by: req.user ? req.user.id : 1
            });

            res.status(201).json({
                success: true,
                message: 'Payment created successfully',
                data: { payment: formatPayment(payment) }
            });
        } catch (error) {
            next(error);
        }
    });

    // PUT /payments/:id — update pending payment
    router.put('/:id', async (req, res, next) => {
        try {
            const storeId = req.user ? req.user.storeId : 1;
            const updateData = {};

            if (req.body.amount !== undefined) updateData.amount = req.body.amount;
            if (req.body.method || req.body.paymentMethod) {
                updateData.method = req.body.method || req.body.paymentMethod;
            }
            if (req.body.notes !== undefined) updateData.notes = req.body.notes;
            if (req.body.status) updateData.status = req.body.status;

            const payment = await paymentService.updatePayment(storeId, req.params.id, updateData);
            res.json({
                success: true,
                message: 'Payment updated successfully',
                data: { payment: formatPayment(payment) }
            });
        } catch (error) {
            next(error);
        }
    });

    // DELETE /payments/:id — delete pending/cancelled payment
    router.delete('/:id', async (req, res, next) => {
        try {
            const storeId = req.user ? req.user.storeId : 1;
            const payment = await paymentService.deletePayment(storeId, req.params.id);
            res.json({
                success: true,
                message: 'Payment deleted successfully',
                data: { payment: formatPayment(payment) }
            });
        } catch (error) {
            next(error);
        }
    });

    // POST /payments/:id/refund — refund a completed payment
    router.post('/:id/refund', async (req, res, next) => {
        try {
            const storeId = req.user ? req.user.storeId : 1;
            const payment = await paymentService.refundPayment(storeId, req.params.id);
            res.json({
                success: true,
                message: 'Payment refunded successfully',
                data: { payment: formatPayment(payment) }
            });
        } catch (error) {
            next(error);
        }
    });

    // POST /payments/vnpay/create-url — create VNPay payment URL
    router.post('/vnpay/create-url', async (req, res, next) => {
        try {
            const storeId = req.user ? req.user.storeId : 1;
            const ipAddr = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
            const data = { ...req.body, created_by: req.user ? req.user.id : 1 };

            const result = await paymentService.createVNPayUrl(storeId, data, ipAddr);

            res.status(201).json({
                success: true,
                message: 'VNPay URL created',
                data: result
            });
        } catch (error) {
            next(error);
        }
    });

    // GET /payments/vnpay/ipn — VNPay IPN Webhook (Public Route)
    router.get('/vnpay/ipn', async (req, res, next) => {
        try {
            const vnpayResponse = await paymentService.processVNPayIPN(req.query);
            res.status(200).json(vnpayResponse);
        } catch (error) {
            console.error('IPN Error:', error);
            res.status(200).json({ RspCode: '99', Message: 'Unknown error' });
        }
    });

    return router;
}

module.exports = createPaymentRouter;
