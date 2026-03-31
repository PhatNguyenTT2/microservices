const fs = require('fs');
const path = require('path');
const logger = require('../../../shared/common/logger');
const { createPool, closePool } = require('../../../shared/db');
const eventBus = require('../../../shared/event-bus');

// Repos
const BatchRepository = require('./repositories/batch.repository');
const WarehouseRepository = require('./repositories/warehouse.repository');
const InventoryRepository = require('./repositories/inventory.repository');
const StockOutRepository = require('./repositories/stock-out.repository');

// Services
const InventoryService = require('./services/inventory.service');
const StockOutService = require('./services/stock-out.service');
const WarehouseService = require('./services/warehouse.service');

// App
const createApp = require('./app');

const PORT = process.env.PORT || 3006;
const SERVICE_NAME = 'inventory-service';

async function initDatabase(pool) {
  const initSql = fs.readFileSync(path.join(__dirname, 'db', 'init.sql'), 'utf8');
  await pool.query(initSql);
  logger.info('Database schema initialized for inventory');
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
    const batchRepo = new BatchRepository(pool);
    const warehouseRepo = new WarehouseRepository(pool);
    const inventoryRepo = new InventoryRepository(pool);
    const stockOutRepo = new StockOutRepository(pool);

    const inventoryService = new InventoryService(inventoryRepo, batchRepo, warehouseRepo, pool);
    const stockOutService = new StockOutService(stockOutRepo, inventoryRepo, batchRepo, pool);
    const warehouseService = new WarehouseService(warehouseRepo, inventoryRepo, pool);

    // 4. Subscribe to events
    await eventBus.subscribe(SERVICE_NAME, 'payment.completed', async (message) => {
      const { orderId, storeId, items, reservedFlow } = message.data;
      const eventId = message.id;
      logger.info({ orderId, storeId, eventId, reservedFlow }, 'Received payment.completed');

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
        if (items && Array.isArray(items)) {
          if (reservedFlow) {
            // Online ordering: stock was already reserved → confirm deduction
            await inventoryService.confirmDeduct(storeId, items, `order_confirmed_${orderId}`);
            logger.info({ orderId, itemCount: items.length }, 'Reserved stock confirmed (online flow)');
          } else {
            // POS flow: deduct directly from on_shelf
            for (const item of items) {
              await inventoryService.deductStock(
                storeId,
                item.batchId,
                item.locationId,
                item.quantity,
                null,
                `pos_sale_order_${orderId}`
              );
            }
            logger.info({ orderId, itemCount: items.length }, 'Stock deducted (POS flow)');
          }
        } else {
          logger.warn({ orderId }, 'payment.completed received without items array — skipping');
        }
      } catch (err) {
        logger.error({ err, orderId }, 'Failed to handle stock on payment.completed');

        // Saga compensation: notify Order Service to revert
        try {
          await eventBus.publish('inventory.deduct_failed', {
            orderId,
            storeId,
            reason: err.message || 'Stock operation failed'
          });
          logger.info({ orderId }, 'Published inventory.deduct_failed for compensation');
        } catch (pubErr) {
          logger.error({ pubErr, orderId }, 'CRITICAL: Failed to publish compensation event');
        }
      }
    });

    // Saga Phase 1: order.created → reserve stock
    await eventBus.subscribe(SERVICE_NAME, 'order.created', async (message) => {
      const { orderId, storeId, items } = message.data;
      const eventId = message.id;
      logger.info({ orderId, storeId, eventId }, 'Received order.created → reserving stock');

      // Idempotency
      try {
        await pool.query('INSERT INTO processed_events (event_id, event_type) VALUES ($1, $2)', [eventId, 'order.created']);
      } catch (dupErr) {
        if (dupErr.code === '23505') { logger.warn({ eventId }, 'Duplicate — skipping'); return; }
        throw dupErr;
      }

      try {
        if (items && Array.isArray(items) && items.length > 0) {
          await inventoryService.reserveStock(storeId, items, `order_${orderId}`);
          await eventBus.publish('stock.reserved', { orderId, storeId, items });
          logger.info({ orderId }, 'Stock reserved → published stock.reserved');
        }
      } catch (err) {
        logger.error({ err, orderId }, 'Stock reservation failed');
        await eventBus.publish('stock.reservation_failed', {
          orderId, storeId, reason: err.message
        });
      }
    });

    // Saga Phase 1: payment.failed → release reserved stock
    await eventBus.subscribe(SERVICE_NAME, 'payment.failed', async (message) => {
      const { orderId, storeId, items } = message.data;
      const eventId = message.id;
      logger.info({ orderId, storeId, eventId }, 'Received payment.failed → releasing reserved stock');

      // Idempotency
      try {
        await pool.query('INSERT INTO processed_events (event_id, event_type) VALUES ($1, $2)', [eventId, 'payment.failed']);
      } catch (dupErr) {
        if (dupErr.code === '23505') { logger.warn({ eventId }, 'Duplicate — skipping'); return; }
        throw dupErr;
      }

      try {
        if (items && Array.isArray(items) && items.length > 0) {
          await inventoryService.releaseStock(storeId, items, `payment_failed_${orderId}`);
          logger.info({ orderId }, 'Reserved stock released');
        }
      } catch (err) {
        logger.error({ err, orderId }, 'Failed to release stock on payment.failed');
      }
    });

    // Saga: payment.timeout → release reserved stock (same as payment.failed)
    await eventBus.subscribe(SERVICE_NAME, 'payment.timeout', async (message) => {
      const { orderId, storeId, items } = message.data;
      const eventId = message.id;
      logger.info({ orderId, storeId, eventId }, 'Received payment.timeout → releasing reserved stock');

      try {
        await pool.query('INSERT INTO processed_events (event_id, event_type) VALUES ($1, $2)', [eventId, 'payment.timeout']);
      } catch (dupErr) {
        if (dupErr.code === '23505') { logger.warn({ eventId }, 'Duplicate — skipping'); return; }
        throw dupErr;
      }

      try {
        if (items && Array.isArray(items) && items.length > 0) {
          await inventoryService.releaseStock(storeId, items, `payment_timeout_${orderId}`);
          logger.info({ orderId }, 'Reserved stock released due to payment timeout');
        }
      } catch (err) {
        logger.error({ err, orderId }, 'Failed to release stock on payment.timeout');
      }
    });

    // 5. Create app (services injected, routes mounted inside app.js)
    const catalogServiceUrl = process.env.CATALOG_SERVICE_URL || 'http://catalog:3002';
    const app = createApp({ inventoryService, stockOutService, warehouseService, batchRepo, inventoryRepo, catalogServiceUrl });
    app.locals.db = pool;

    // 7. Start server
    const server = app.listen(PORT, () => {
      logger.info(`${SERVICE_NAME} running on port ${PORT}`);
    });

    // 8. Saga §5.3: Outbox poller
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
