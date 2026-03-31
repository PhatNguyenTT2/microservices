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

    // 4. Create app (pool does not leak to routes)
    const createApp = require('./app');
    const app = createApp({ supplierService, poService });
    app.locals.db = pool;

    // 5. Start server
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
