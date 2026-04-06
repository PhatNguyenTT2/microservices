const fs = require('fs');
const path = require('path');
const logger = require('../../../shared/common/logger');
const { createPool, closePool } = require('../../../shared/db');
const eventBus = require('../../../shared/event-bus');
const EVENT = require('../../../shared/event-bus/eventTypes');

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
    await eventBus.subscribe(SERVICE_NAME, EVENT.PAYMENT_COMPLETED, async (message) => {
      const { orderId, storeId, items, deliveryType, referenceType } = message.data;
      const eventId = message.id;

      // Only handle SaleOrder references (skip PurchaseOrder)
      if (referenceType && referenceType !== 'SaleOrder') return;

      logger.info({ orderId, storeId, eventId, deliveryType, itemCount: items?.length }, 'Received payment.completed');

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
        if (items && Array.isArray(items) && items.length > 0) {
          if (deliveryType === 'delivery') {
            // Delivery flow: skip — stock will be reserved when order.shipping fires (Phase 1)
            logger.info({ orderId }, 'Delivery order — skipping inventory, will reserve on order.shipping');
          } else {
            // Pickup flow: deduct directly from on_shelf (immediate sale)
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
            logger.info({ orderId, itemCount: items.length }, 'Stock deducted (pickup/POS flow)');
          }
        } else {
          logger.warn({ orderId }, 'payment.completed received without items array — skipping inventory');
        }
      } catch (err) {
        logger.error({ err, orderId }, 'Failed to handle stock on payment.completed');

        // Saga compensation: notify Order Service to revert
        try {
          await eventBus.publish(EVENT.INVENTORY_DEDUCT_FAILED, {
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

    // order.delivered: Delivery order confirmed → deduct reserved stock (Phase 2)
    await eventBus.subscribe(SERVICE_NAME, EVENT.ORDER_DELIVERED, async (message) => {
      const { orderId, storeId, items, deliveryType } = message.data;
      const eventId = message.id;
      logger.info({ orderId, storeId, eventId, deliveryType, itemCount: items?.length }, 'Received order.delivered');

      // Pickup orders: inventory already deducted at payment.completed — skip
      if (deliveryType === 'pickup') {
        logger.info({ orderId }, 'Pickup order delivered — inventory already deducted at payment, skipping');
        return;
      }

      // Idempotency
      try {
        await pool.query('INSERT INTO processed_events (event_id, event_type, service_name) VALUES ($1, $2, $3)', [eventId, EVENT.ORDER_DELIVERED, SERVICE_NAME]);
      } catch (dupErr) {
        if (dupErr.code === '23505') { logger.warn({ eventId }, 'Duplicate — skipping'); return; }
        throw dupErr;
      }

      try {
        if (items && Array.isArray(items) && items.length > 0) {
          // Delivery Phase 2: reserved → sold (giải phóng reserved)
          await inventoryService.confirmDeduct(storeId, items, `order_delivered_${orderId}`);
          logger.info({ orderId }, 'Delivery confirmed — reserved stock deducted (sold)');
        }
      } catch (err) {
        logger.error({ err, orderId }, 'Failed to confirm deduct on order.delivered');
      }
    });

    // order.cancelled (shipping→cancelled): Release reserved back to on_hand
    await eventBus.subscribe(SERVICE_NAME, EVENT.ORDER_CANCELLED, async (message) => {
      const { orderId, storeId, items } = message.data;
      const eventId = message.id;
      logger.info({ orderId, storeId, eventId, itemCount: items?.length }, 'Received order.cancelled → releasing reserved stock');

      // Idempotency
      try {
        await pool.query('INSERT INTO processed_events (event_id, event_type, service_name) VALUES ($1, $2, $3)', [eventId, EVENT.ORDER_CANCELLED, SERVICE_NAME]);
      } catch (dupErr) {
        if (dupErr.code === '23505') { logger.warn({ eventId }, 'Duplicate — skipping'); return; }
        throw dupErr;
      }

      try {
        if (items && Array.isArray(items) && items.length > 0) {
          // Release: reserved → on_hand (goods returned to warehouse, not shelf)
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            for (const item of items) {
              const invItem = await inventoryRepo.findItemForUpdateWithClient(client, item.batchId, item.locationId);
              if (!invItem) continue;

              const releaseQty = Math.min(item.quantity, invItem.quantity_reserved);
              if (releaseQty <= 0) continue;

              // reserved -= qty, on_hand += qty
              await inventoryRepo.updateItemQuantitiesWithClient(
                client, invItem.id, releaseQty, 0, -releaseQty
              );
              await inventoryRepo.recordMovementWithClient(client, {
                inventory_item_id: invItem.id,
                movement_type: 'release',
                quantity: releaseQty,
                reason: `order_cancelled_${orderId}`,
                performed_by: null
              });
            }
            await client.query('COMMIT');
          } catch (e) {
            await client.query('ROLLBACK');
            throw e;
          } finally {
            client.release();
          }
          logger.info({ orderId }, 'Reserved stock released back to on_hand');
        }
      } catch (err) {
        logger.error({ err, orderId }, 'Failed to release stock on order.cancelled');
      }
    });

    // order.shipping: Payment completed for delivery order → reserve stock (on_shelf → reserved)
    await eventBus.subscribe(SERVICE_NAME, EVENT.ORDER_SHIPPING, async (message) => {
      const { orderId, storeId, items } = message.data;
      const eventId = message.id;
      logger.info({ orderId, storeId, eventId }, 'Received order.shipping → reserving stock for delivery');

      // Idempotency
      try {
        await pool.query('INSERT INTO processed_events (event_id, event_type, service_name) VALUES ($1, $2, $3)', [eventId, EVENT.ORDER_SHIPPING, SERVICE_NAME]);
      } catch (dupErr) {
        if (dupErr.code === '23505') { logger.warn({ eventId }, 'Duplicate — skipping'); return; }
        throw dupErr;
      }

      try {
        if (items && Array.isArray(items) && items.length > 0) {
          await inventoryService.reserveStock(storeId, items, `order_shipping_${orderId}`);
          logger.info({ orderId, itemCount: items.length }, 'Stock reserved for shipping order');
        }
      } catch (err) {
        logger.error({ err, orderId }, 'Stock reservation failed on order.shipping');
        await eventBus.publish(EVENT.INVENTORY_DEDUCT_FAILED, {
          orderId, storeId, reason: err.message
        });
      }
    });

    // Saga Phase 1: payment.failed → release reserved stock
    await eventBus.subscribe(SERVICE_NAME, EVENT.PAYMENT_FAILED, async (message) => {
      const { orderId, storeId, items } = message.data;
      const eventId = message.id;
      logger.info({ orderId, storeId, eventId }, 'Received payment.failed → releasing reserved stock');

      // Idempotency
      try {
        await pool.query('INSERT INTO processed_events (event_id, event_type, service_name) VALUES ($1, $2, $3)', [eventId, EVENT.PAYMENT_FAILED, SERVICE_NAME]);
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
    await eventBus.subscribe(SERVICE_NAME, EVENT.PAYMENT_TIMEOUT, async (message) => {
      const { orderId, storeId, items } = message.data;
      const eventId = message.id;
      logger.info({ orderId, storeId, eventId }, 'Received payment.timeout → releasing reserved stock');

      try {
        await pool.query('INSERT INTO processed_events (event_id, event_type, service_name) VALUES ($1, $2, $3)', [eventId, EVENT.PAYMENT_TIMEOUT, SERVICE_NAME]);
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

    // order.refunded: Admin confirmed full refund → return stock to warehouse (on_hand)
    await eventBus.subscribe(SERVICE_NAME, EVENT.ORDER_REFUNDED, async (message) => {
      const { orderId, storeId, items } = message.data;
      const eventId = message.id;
      logger.info({ orderId, storeId, eventId, itemCount: items?.length }, 'Received order.refunded → returning stock to warehouse');

      // Idempotency
      try {
        await pool.query(
          'INSERT INTO processed_events (event_id, event_type, service_name) VALUES ($1, $2, $3)',
          [eventId, EVENT.ORDER_REFUNDED, SERVICE_NAME]
        );
      } catch (dupErr) {
        if (dupErr.code === '23505') { logger.warn({ eventId }, 'Duplicate — skipping'); return; }
        throw dupErr;
      }

      try {
        if (items && Array.isArray(items) && items.length > 0) {
          await inventoryService.returnStock(storeId, items, `refund_return_${orderId}`);
          logger.info({ orderId, itemCount: items.length }, 'Stock returned to on_hand (warehouse)');
        }
      } catch (err) {
        logger.error({ err, orderId }, 'Failed to return stock on order.refunded');
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
