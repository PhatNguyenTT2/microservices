const fs = require('fs');
const path = require('path');
const logger = require('../../../shared/common/logger');
const { createPool, closePool } = require('../../../shared/db');
const eventBus = require('../../../shared/event-bus');

// Repositories
const SupplierRepository = require('./repositories/supplier.repository');
const PurchaseOrderRepository = require('./repositories/purchase-order.repository');
const PoDetailRepository = require('./repositories/purchase-order-detail.repository');

// Services
const SupplierService = require('./services/supplier.service');
const PurchaseOrderService = require('./services/purchase-order.service');

const PORT = process.env.PORT || 3005; // Service 5 — Supplier
const SERVICE_NAME = 'supplier-service';

async function initDatabase(pool) {
  const initSql = fs.readFileSync(path.join(__dirname, 'db', 'init.sql'), 'utf8');
  await pool.query(initSql);
  logger.info('Database schema initialized');
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
    const supplierRepo = new SupplierRepository(pool);
    const purchaseOrderRepo = new PurchaseOrderRepository(pool);
    const poDetailRepo = new PoDetailRepository(pool);

    const supplierService = new SupplierService({ supplierRepo });
    const poService = new PurchaseOrderService( 
      purchaseOrderRepo, poDetailRepo, supplierRepo, pool,
      { inventoryServiceUrl: process.env.INVENTORY_SERVICE_URL || 'http://inventory:3006' }
    );

    // 4. Subscribe to payment events for PO payment_status sync
    await eventBus.subscribe(SERVICE_NAME, 'payment.completed', async (message) => {
      const { orderId, storeId, referenceType, amount, totalPaidSoFar } = message.data;
      const eventId = message.id;

      // Only handle PurchaseOrder
      if (referenceType !== 'PurchaseOrder') return;

      logger.info({ orderId, storeId, eventId, amount, totalPaidSoFar }, 'Received payment.completed for PO');

      // Idempotency
      try {
        await pool.query('INSERT INTO processed_events (event_id, event_type) VALUES ($1, $2)', [eventId, 'payment.completed']);
      } catch (dupErr) {
        if (dupErr.code === '23505') { logger.warn({ eventId }, 'Duplicate — skipping'); return; }
        throw dupErr;
      }

      try {
        const po = await purchaseOrderRepo.findById(storeId, orderId);
        if (!po) { logger.warn({ orderId, storeId }, 'PO not found'); return; }

        const poTotal = parseFloat(po.total_price);
        const newPaymentStatus = totalPaidSoFar >= poTotal ? 'paid' : 'partial';

        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await purchaseOrderRepo.updateStatusWithClient(client, storeId, orderId, null, newPaymentStatus);
          await client.query('COMMIT');
          logger.info({ orderId, newPaymentStatus, totalPaidSoFar, poTotal }, 'PO payment_status updated');
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally {
          client.release();
        }
      } catch (err) {
        logger.error({ err: err.message, orderId }, 'Failed to process payment.completed for PO');
      }
    });

    await eventBus.subscribe(SERVICE_NAME, 'payment.refunded', async (message) => {
      const { orderId, storeId, referenceType, allRefunded } = message.data;
      const eventId = message.id;

      // Only handle PurchaseOrder
      if (referenceType !== 'PurchaseOrder') return;

      logger.info({ orderId, storeId, eventId, allRefunded }, 'Received payment.refunded for PO');

      // Idempotency
      try {
        await pool.query('INSERT INTO processed_events (event_id, event_type) VALUES ($1, $2)', [eventId, 'payment.refunded']);
      } catch (dupErr) {
        if (dupErr.code === '23505') { logger.warn({ eventId }, 'Duplicate — skipping'); return; }
        throw dupErr;
      }

      try {
        const po = await purchaseOrderRepo.findById(storeId, orderId);
        if (!po) { logger.warn({ orderId, storeId }, 'PO not found'); return; }

        const newPaymentStatus = allRefunded ? 'refunded' : 'partial_refund';

        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await purchaseOrderRepo.updateStatusWithClient(client, storeId, orderId, null, newPaymentStatus);
          await client.query('COMMIT');
          logger.info({ orderId, newPaymentStatus }, 'PO payment_status updated on refund');
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally {
          client.release();
        }
      } catch (err) {
        logger.error({ err: err.message, orderId }, 'Failed to process payment.refunded for PO');
      }
    });

    // 5. Create app (pool does not leak to routes)
    const createApp = require('./app');
    const app = createApp({ supplierService, poService });
    app.locals.db = pool;

    // 6. Start server
    const server = app.listen(PORT, () => {
      logger.info(`${SERVICE_NAME} running on port ${PORT}`);
    });

    // Graceful shutdown
    const shutdown = async (signal) => {
      logger.info(`${signal} received, shutting down...`);
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
