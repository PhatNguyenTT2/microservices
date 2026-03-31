const express = require('express');
const { verifyToken } = require('../../../../shared/auth-middleware');

/**
 * Order Detail Routes
 * Provides endpoints for querying and managing order line items
 */
function createOrderDetailRouter(orderService, orderDetailRepo) {
  const router = express.Router();

  // Format detail row from snake_case → camelCase
  function formatDetail(row) {
    if (!row) return null;
    return {
      id: row.id,
      orderId: row.order_id,
      productName: row.product_name,
      batchId: row.batch_id,
      quantity: row.quantity,
      unitPrice: parseFloat(row.unit_price || 0),
      totalPrice: parseFloat(row.total_price || 0)
    };
  }

  // GET /api/order-details — query by order, product, batch
  router.get('/', verifyToken, async (req, res, next) => {
    try {
      const { order: orderId } = req.query;

      if (!orderId) {
        return res.status(400).json({
          status: 'error',
          message: 'order query parameter is required'
        });
      }

      const rows = await orderDetailRepo.findByOrderId(orderId);
      const details = rows.map(formatDetail);

      res.json({
        status: 'success',
        data: { orderDetails: details }
      });
    } catch (error) {
      next(error);
    }
  });

  // GET /api/order-details/:id — get single detail
  router.get('/:id', verifyToken, async (req, res, next) => {
    try {
      const { rows } = await orderDetailRepo.pool.query(
        'SELECT * FROM sale_order_detail WHERE id = $1',
        [req.params.id]
      );

      if (rows.length === 0) {
        return res.status(404).json({ status: 'error', message: 'Order detail not found' });
      }

      res.json({
        status: 'success',
        data: { orderDetail: formatDetail(rows[0]) }
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = createOrderDetailRouter;
