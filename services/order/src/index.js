const fs = require('fs');
const path = require('path');
const logger = require('../../../shared/common/logger');
const { createPool, closePool } = require('../../../shared/db');
const eventBus = require('../../../shared/event-bus');
const EVENT = require('../../../shared/event-bus/eventTypes');

// Repositories
const OrderRepository = require('./repositories/order.repository');
const OrderDetailRepository = require('./repositories/order-detail.repository');

// Services
const OrderService = require('./services/order.service');

const PORT = process.env.PORT || 3003;
const SERVICE_NAME = 'order-service';

async function initDatabase(pool) {
  const initSql = fs.readFileSync(path.join(__dirname, 'db', 'init.sql'), 'utf8');
  await pool.query(initSql);
  logger.info('Database schema initialized for orders');
}

async function start() {
  try {
    // 1. Database
    const pool = createPool();
    await initDatabase(pool);
    logger.info('PostgreSQL connected');

    // 2. Event bus
    await eventBus.connect();
    logger.info('RabbitMQ connected');

    // 3. Build dependency graph
    const orderRepo = new OrderRepository(pool);
    const orderDetailRepo = new OrderDetailRepository(pool);

    const orderService = new OrderService(orderRepo, orderDetailRepo, pool);

    // 4. Subscribe to events
    // =============================================
    // payment.completed → update order status
    // POS(pickup):  draft → delivered, paid
    // Online(delivery): draft → shipping, paid
    // =============================================
    await eventBus.subscribe(SERVICE_NAME, EVENT.PAYMENT_COMPLETED, async (message) => {
      const { orderId, storeId, deliveryType, referenceType } = message.data;
      const eventId = message.id;

      // Only handle SaleOrder references (skip PurchaseOrder)
      if (referenceType && referenceType !== 'SaleOrder') return;

      // Type safety — orderId/storeId may arrive as strings from JSON
      const safeOrderId = parseInt(orderId, 10);
      const safeStoreId = parseInt(storeId, 10);

      logger.info({ orderId: safeOrderId, storeId: safeStoreId, deliveryType, eventId, rawOrderId: orderId, rawStoreId: storeId }, 'Received payment.completed → updating order status');

      if (isNaN(safeOrderId) || isNaN(safeStoreId)) {
        logger.error({ orderId, storeId, eventId }, 'INVALID orderId or storeId — cannot process');
        return;
      }

      // Idempotency check
      try {
        await pool.query(
          'INSERT INTO processed_events (event_id, event_type, service_name) VALUES ($1, $2, $3)',
          [eventId, EVENT.PAYMENT_COMPLETED, SERVICE_NAME]
        );
      } catch (dupErr) {
        if (dupErr.code === '23505') {
          logger.warn({ eventId }, 'Duplicate event — skipping');
          return;
        }
        throw dupErr;
      }

      try {
        const targetStatus = deliveryType === 'delivery' ? 'shipping' : 'delivered';
        logger.info({ orderId: safeOrderId, storeId: safeStoreId, targetStatus, paymentStatus: 'paid' }, 'About to call updateOrderStatus');

        await orderService.updateOrderStatus(safeStoreId, safeOrderId, targetStatus, 'paid');
        logger.info({ orderId: safeOrderId, targetStatus }, 'Order status updated successfully');
      } catch (err) {
        logger.error({ err: err.message, stack: err.stack, orderId: safeOrderId, storeId: safeStoreId }, 'CRITICAL: Failed to update order status on payment.completed');
        throw err;
      }
    });

    // payment.failed → cancel order
    await eventBus.subscribe(SERVICE_NAME, EVENT.PAYMENT_FAILED, async (message) => {
      const { orderId, storeId, reason } = message.data;
      const eventId = message.id;
      logger.info({ orderId, storeId, reason, eventId }, 'Received payment.failed');

      try {
        await pool.query(
          'INSERT INTO processed_events (event_id, event_type, service_name) VALUES ($1, $2, $3)',
          [eventId, EVENT.PAYMENT_FAILED, SERVICE_NAME]
        );
      } catch (dupErr) {
        if (dupErr.code === '23505') {
          logger.warn({ eventId }, 'Duplicate event — skipping');
          return;
        }
        throw dupErr;
      }

      try {
        await orderService.updateOrderStatus(storeId, orderId, 'cancelled', 'failed');
        logger.info({ orderId }, 'Order cancelled due to payment failure');
      } catch (err) {
        logger.error({ err, orderId }, 'Failed to cancel order on payment.failed');
      }
    });

    // Saga compensation: inventory deduct failed → revert order
    await eventBus.subscribe(SERVICE_NAME, EVENT.INVENTORY_DEDUCT_FAILED, async (message) => {
      const { orderId, storeId, reason } = message.data;
      const eventId = message.id;
      logger.info({ orderId, storeId, reason, eventId }, 'Received inventory.deduct_failed → reverting order');

      try {
        await pool.query(
          'INSERT INTO processed_events (event_id, event_type, service_name) VALUES ($1, $2, $3)',
          [eventId, EVENT.INVENTORY_DEDUCT_FAILED, SERVICE_NAME]
        );
      } catch (dupErr) {
        if (dupErr.code === '23505') {
          logger.warn({ eventId }, 'Duplicate event — skipping');
          return;
        }
        throw dupErr;
      }

      try {
        await orderService.updateOrderStatus(storeId, orderId, 'cancelled', 'failed');
        logger.info({ orderId }, 'Order reverted to cancelled due to inventory deduct failure');
      } catch (err) {
        logger.error({ err, orderId }, 'CRITICAL: Failed to revert order on inventory.deduct_failed');
      }
    });

    // payment.timeout → cancel order (VNPay expired)
    await eventBus.subscribe(SERVICE_NAME, EVENT.PAYMENT_TIMEOUT, async (message) => {
      const { orderId, storeId, reason } = message.data;
      const eventId = message.id;
      logger.info({ orderId, storeId, reason, eventId }, 'Received payment.timeout → cancelling order');

      try {
        await pool.query('INSERT INTO processed_events (event_id, event_type, service_name) VALUES ($1, $2, $3)', [eventId, EVENT.PAYMENT_TIMEOUT, SERVICE_NAME]);
      } catch (dupErr) {
        if (dupErr.code === '23505') { logger.warn({ eventId }, 'Duplicate — skipping'); return; }
        throw dupErr;
      }

      try {
        await orderService.updateOrderStatus(storeId, orderId, 'cancelled', 'failed');
        logger.info({ orderId }, 'Order cancelled due to payment timeout');
      } catch (err) {
        logger.error({ err, orderId }, 'Failed to cancel order on payment.timeout');
      }
    });

    // Refund: payment.refunded → update order payment_status
    await eventBus.subscribe(SERVICE_NAME, EVENT.PAYMENT_REFUNDED, async (message) => {
      const { orderId, storeId, referenceType, allRefunded } = message.data;
      const eventId = message.id;

      if (referenceType !== 'SaleOrder') {
        logger.info({ orderId, referenceType, eventId }, 'payment.refunded skipped: not SaleOrder');
        return;
      }

      logger.info({ orderId, storeId, eventId, allRefunded }, 'Received payment.refunded');

      try {
        await pool.query(
          'INSERT INTO processed_events (event_id, event_type, service_name) VALUES ($1, $2, $3)',
          [eventId, EVENT.PAYMENT_REFUNDED, SERVICE_NAME]
        );
      } catch (dupErr) {
        if (dupErr.code === '23505') { logger.warn({ eventId }, 'Duplicate — skipping'); return; }
        throw dupErr;
      }

      try {
        const { rows } = await pool.query(
          'SELECT id, status, payment_status FROM sale_order WHERE id = $1 AND store_id = $2',
          [orderId, storeId]
        );
        const order = rows[0];

        if (!order) {
          logger.warn({ orderId, storeId }, 'payment.refunded: order not found');
          return;
        }

        if (!['delivered', 'shipping'].includes(order.status)) {
          logger.warn({ orderId, status: order.status }, 'payment.refunded: order status not eligible');
          return;
        }

        const newPaymentStatus = allRefunded ? 'refunded' : 'partial_refund';

        const updateResult = await pool.query(
          `UPDATE sale_order SET payment_status = $1 WHERE id = $2 AND store_id = $3 RETURNING id, payment_status`,
          [newPaymentStatus, orderId, storeId]
        );

        if (updateResult.rows[0]) {
          logger.info({ orderId, newPaymentStatus: updateResult.rows[0].payment_status }, `Order payment_status updated to ${newPaymentStatus}`);
        } else {
          logger.error({ orderId }, 'payment.refunded: UPDATE returned no rows');
        }
      } catch (err) {
        logger.error({ err: err.message, code: err.code, detail: err.detail, orderId }, 'Failed to process payment.refunded in order');
      }
    });

    // NOTE: stock.reserved and stock.reservation_failed subscriptions REMOVED
    // New simplified flow: draft → (payment.completed) → shipping/delivered
    // No more pending/reserved statuses

    // 5. Create Express app
    const createApp = require('./app');
    const app = createApp({ orderService, orderDetailRepo });
    app.locals.db = pool;

    // 6. Start server
    const server = app.listen(PORT, () => {
      logger.info(`${SERVICE_NAME} running on port ${PORT}`);
    });

    // 7. Outbox poller — CRITICAL: pass SERVICE_NAME for shared-DB isolation
    const outbox = require('../../../shared/outbox');
    const outboxPoller = outbox.startPoller(pool, eventBus, 3000, SERVICE_NAME);

    // Graceful shutdown
    const shutdown = async (signal) => {
      logger.info(`${signal} received, shutting down...`);
      clearInterval(outboxPoller);
      server.close();
      await eventBus.close();
      await closePool();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (err) {
    logger.error(err, 'Failed to start service');
    process.exit(1);
  }
}

start();
