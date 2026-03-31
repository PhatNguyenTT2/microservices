const fs = require('fs');
const path = require('path');
const logger = require('../../../shared/common/logger');
const { createPool, closePool } = require('../../../shared/db');
const eventBus = require('../../../shared/event-bus');

// Repositories
const CategoryRepository = require('./repositories/category.repository');
const ProductRepository = require('./repositories/product.repository');
const PriceHistoryRepository = require('./repositories/price-history.repository');

// Services
const CategoryService = require('./services/category.service');
const ProductService = require('./services/product.service');

const PORT = process.env.PORT || 3002; // Service 2 — Catalog
const SERVICE_NAME = 'catalog-service';

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
    const categoryRepo = new CategoryRepository(pool);
    const productRepo = new ProductRepository(pool);
    const priceHistoryRepo = new PriceHistoryRepository(pool);

    const categoryService = new CategoryService(categoryRepo, productRepo);
    const productService = new ProductService(productRepo, categoryRepo, priceHistoryRepo, pool);

    // 4. Create app
    const createApp = require('./app');
    const app = createApp({ categoryService, productService });
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
