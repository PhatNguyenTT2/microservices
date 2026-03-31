const fs = require('fs');
const path = require('path');
const logger = require('../../../shared/common/logger');
const { createPool, closePool } = require('../../../shared/db');
const eventBus = require('../../../shared/event-bus');

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
    await eventBus.subscribe(SERVICE_NAME, 'payment.completed', async (message) => {
      const { orderId, storeId } = message.data;
      const eventId = message.id;
      logger.info({ orderId, storeId, eventId }, 'Received payment.completed → updating order status');

      // Idempotency check
      try {
        await pool.query(
          'INSERT INTO processed_events (event_id, event_type) VALUES ($1, $2)',
          [eventId, 'payment.completed']
        );
      } catch (dupErr) {
        if (dupErr.code === '23505') {
          logger.warn({ eventId }, 'Duplicate event — skipping');
          return;
        }
        throw dupErr;
      }

      try {
        await orderService.updateOrderStatus(storeId, orderId, 'completed', 'paid');
        logger.info({ orderId }, 'Order status updated to completed/paid');
      } catch (err) {
        logger.error({ err, orderId }, 'Failed to update order status on payment.completed');
      }
    });

    await eventBus.subscribe(SERVICE_NAME, 'payment.failed', async (message) => {
      const { orderId, storeId, reason } = message.data;
      const eventId = message.id;
      logger.info({ orderId, storeId, reason, eventId }, 'Received payment.failed');

      // Idempotency check
      try {
        await pool.query(
          'INSERT INTO processed_events (event_id, event_type) VALUES ($1, $2)',
          [eventId, 'payment.failed']
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
    await eventBus.subscribe(SERVICE_NAME, 'inventory.deduct_failed', async (message) => {
      const { orderId, storeId, reason } = message.data;
      const eventId = message.id;
      logger.info({ orderId, storeId, reason, eventId }, 'Received inventory.deduct_failed → reverting order');

      // Idempotency check
      try {
        await pool.query(
          'INSERT INTO processed_events (event_id, event_type) VALUES ($1, $2)',
          [eventId, 'inventory.deduct_failed']
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

    // Saga Phase 1: stock reserved → update order to reserved
    await eventBus.subscribe(SERVICE_NAME, 'stock.reserved', async (message) => {
      const { orderId, storeId } = message.data;
      const eventId = message.id;
      logger.info({ orderId, storeId, eventId }, 'Received stock.reserved → updating order to reserved');

      try {
        await pool.query('INSERT INTO processed_events (event_id, event_type) VALUES ($1, $2)', [eventId, 'stock.reserved']);
      } catch (dupErr) {
        if (dupErr.code === '23505') { logger.warn({ eventId }, 'Duplicate — skipping'); return; }
        throw dupErr;
      }

      try {
        await orderService.updateOrderStatus(storeId, orderId, 'reserved', null);
        logger.info({ orderId }, 'Order status updated to reserved');
      } catch (err) {
        logger.error({ err, orderId }, 'Failed to update order to reserved');
      }
    });

    // Saga Phase 1: stock reservation failed → cancel order
    await eventBus.subscribe(SERVICE_NAME, 'stock.reservation_failed', async (message) => {
      const { orderId, storeId, reason } = message.data;
      const eventId = message.id;
      logger.info({ orderId, storeId, reason, eventId }, 'Received stock.reservation_failed → cancelling order');

      try {
        await pool.query('INSERT INTO processed_events (event_id, event_type) VALUES ($1, $2)', [eventId, 'stock.reservation_failed']);
      } catch (dupErr) {
        if (dupErr.code === '23505') { logger.warn({ eventId }, 'Duplicate — skipping'); return; }
        throw dupErr;
      }

      try {
        await orderService.updateOrderStatus(storeId, orderId, 'cancelled', null);
        logger.info({ orderId }, 'Order cancelled due to stock reservation failure');
      } catch (err) {
        logger.error({ err, orderId }, 'Failed to cancel order on stock.reservation_failed');
      }
    });

    // Saga: payment.timeout → cancel order (VNPay expired)
    await eventBus.subscribe(SERVICE_NAME, 'payment.timeout', async (message) => {
      const { orderId, storeId, reason } = message.data;
      const eventId = message.id;
      logger.info({ orderId, storeId, reason, eventId }, 'Received payment.timeout → cancelling order');

      try {
        await pool.query('INSERT INTO processed_events (event_id, event_type) VALUES ($1, $2)', [eventId, 'payment.timeout']);
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

    // 5. Create Express app
    const createApp = require('./app');
    const app = createApp({ orderService, orderDetailRepo });
    app.locals.db = pool;

    // 6. Start server
    const server = app.listen(PORT, () => {
      logger.info(`${SERVICE_NAME} running on port ${PORT}`);
    });

    // 7. Saga §5.3: Outbox poller
    const outbox = require('../../../shared/outbox');
    const outboxPoller = outbox.startPoller(pool, eventBus, 3000);

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
