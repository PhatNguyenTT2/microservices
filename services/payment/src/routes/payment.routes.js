const express = require('express');

function createPaymentRouter(paymentService) {
    const router = express.Router();

    router.get('/', async (req, res, next) => {
        try {
            const storeId = req.user ? req.user.storeId : 1;
            const filters = {
                referenceType: req.query.referenceType,
                referenceId: req.query.referenceId
            };
            const payments = await paymentService.getPayments(storeId, filters);
            res.json({
                status: 'success',
                data: { payments }
            });
        } catch (error) {
            next(error);
        }
    });

    router.post('/direct', async (req, res, next) => {
        try {
            const storeId = req.user ? req.user.storeId : 1;
            const data = { ...req.body, created_by: req.user ? req.user.id : 1 };
            
            const payment = await paymentService.createDirectPayment(storeId, data);
            
            res.status(201).json({
                status: 'success',
                message: 'Direct payment completed successfully',
                data: { payment }
            });
        } catch (error) {
            next(error);
        }
    });

    router.post('/vnpay/create-url', async (req, res, next) => {
        try {
            const storeId = req.user ? req.user.storeId : 1;
            const ipAddr = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
            const data = { ...req.body, created_by: req.user ? req.user.id : 1 };
            
            const result = await paymentService.createVNPayUrl(storeId, data, ipAddr);
            
            res.status(201).json({
                status: 'success',
                message: 'VNPay URL created',
                data: result
            });
        } catch (error) {
            next(error);
        }
    });

    // VNPay IPN Webhook (Public Route - Server to Server)
    router.get('/vnpay/ipn', async (req, res, next) => {
        try {
            const vnpayResponse = await paymentService.processVNPayIPN(req.query);
            res.status(200).json(vnpayResponse);
        } catch (error) {
            console.error('IPN Error:', error);
            res.status(200).json({ RspCode: '99', Message: 'Unknown error' }); // VNPay expects 200 OK
        }
    });

    return router;
}

module.exports = createPaymentRouter;
