const express = require('express');
const { verifyToken } = require('../../../../shared/auth-middleware');

function createStockOutRouter(stockOutService) {
    const router = express.Router();

    // Helper: snake_case → camelCase mapping for order
    const formatOrder = (row) => ({
        id: row.id,
        storeId: row.store_id,
        orderDate: row.order_date,
        completedDate: row.completed_date,
        reason: row.reason,
        destination: row.destination,
        status: row.status,
        totalPrice: parseFloat(row.total_price) || 0,
        createdBy: row.created_by,
        // If details are included
        ...(row.details ? {
            details: row.details.map(d => ({
                id: d.id,
                soId: d.so_id,
                batchId: d.batch_id,
                productId: d.product_id,
                quantity: d.quantity,
                unitPrice: parseFloat(d.unit_price) || 0,
                totalPrice: parseFloat(d.total_price) || 0,
                batchUnitPrice: parseFloat(d.batch_unit_price) || 0,
                expiryDate: d.expiry_date,
                mfgDate: d.mfg_date
            }))
        } : {})
    });

    // GET / — List all stock out orders
    router.get('/', verifyToken, async (req, res, next) => {
        try {
            const storeId = req.user ? req.user.storeId : 1;
            const orders = await stockOutService.getOrders(storeId, req.query);
            res.json({
                success: true,
                data: { orders: orders.map(formatOrder) }
            });
        } catch (error) {
            next(error);
        }
    });

    // GET /:id — Get order with details
    router.get('/:id', verifyToken, async (req, res, next) => {
        try {
            const storeId = req.user ? req.user.storeId : 1;
            const order = await stockOutService.getOrderById(storeId, parseInt(req.params.id));
            res.json({
                success: true,
                data: { order: formatOrder(order) }
            });
        } catch (error) {
            next(error);
        }
    });

    // POST / — Create order with items
    router.post('/', verifyToken, async (req, res, next) => {
        try {
            const storeId = req.user ? req.user.storeId : 1;
            const userId = req.user ? req.user.id : 1;
            const order = await stockOutService.createOrder(storeId, req.body, userId);
            res.status(201).json({
                success: true,
                data: { order: formatOrder(order) }
            });
        } catch (error) {
            next(error);
        }
    });

    // PUT /:id — Update order (full edit for draft, header-only for pending)
    router.put('/:id', verifyToken, async (req, res, next) => {
        try {
            const storeId = req.user ? req.user.storeId : 1;
            const userId = req.user ? req.user.id : 1;
            const order = await stockOutService.updateOrder(storeId, parseInt(req.params.id), req.body, userId);
            res.json({
                success: true,
                data: { order: formatOrder(order) }
            });
        } catch (error) {
            next(error);
        }
    });

    // DELETE /:id — Delete draft order
    router.delete('/:id', verifyToken, async (req, res, next) => {
        try {
            const storeId = req.user ? req.user.storeId : 1;
            const result = await stockOutService.deleteOrder(storeId, parseInt(req.params.id));
            res.json({ success: true, message: result.message });
        } catch (error) {
            next(error);
        }
    });

    // PUT /:id/status — Update status (draft→pending→completed, or →cancelled)
    router.put('/:id/status', verifyToken, async (req, res, next) => {
        try {
            const storeId = req.user ? req.user.storeId : 1;
            const userId = req.user ? req.user.id : 1;
            const { status } = req.body;
            const result = await stockOutService.updateStatus(storeId, parseInt(req.params.id), status, userId);
            res.json({
                success: true,
                data: result.message ? { message: result.message } : { order: formatOrder(result) }
            });
        } catch (error) {
            next(error);
        }
    });

    return router;
}

module.exports = createStockOutRouter;
