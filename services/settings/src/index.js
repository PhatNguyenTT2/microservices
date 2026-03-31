const fs = require('fs');
const path = require('path');
const logger = require('../../../shared/common/logger');
const { createPool, closePool } = require('../../../shared/db');
const eventBus = require('../../../shared/event-bus');

// Repositories
const SecuritySettingsRepository = require('./repositories/security-settings.repository');
const SalesSettingsRepository = require('./repositories/sales-settings.repository');
const SettingsHistoryRepository = require('./repositories/settings-history.repository');

// Services
const SettingsService = require('./services/settings.service');

const PORT = process.env.PORT || 3004; // Service 4 — Settings
const SERVICE_NAME = 'settings-service';

async function initDatabase(pool) {
  const initSql = fs.readFileSync(path.join(__dirname, 'db', 'init.sql'), 'utf8');
  await pool.query(initSql);
  logger.info('Database schema and seed initialized');
}

async function start() {
  try {
    const pool = createPool();
    await initDatabase(pool);
    logger.info('PostgreSQL connected');

    await eventBus.connect();
    logger.info('RabbitMQ connected');

    const securityRepo = new SecuritySettingsRepository(pool);
    const salesRepo = new SalesSettingsRepository(pool);
    const historyRepo = new SettingsHistoryRepository(pool);

    const settingsService = new SettingsService({ 
      securitySettingsRepo: securityRepo, 
      salesSettingsRepo: salesRepo, 
      historyRepo, 
      pool 
    });

    const createApp = require('./app');
    const app = createApp({ settingsService });
    app.locals.db = pool;

    const server = app.listen(PORT, () => {
      logger.info(`${SERVICE_NAME} running on port ${PORT}`);
    });

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
