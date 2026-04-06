const fs = require('fs');
const path = require('path');
const logger = require('../../../shared/common/logger');
const { createPool, closePool } = require('../../../shared/db');
const eventBus = require('../../../shared/event-bus');

// Repositories
const PaymentRepository = require('./repositories/payment.repository');
const VNPayRepository = require('./repositories/vnpay.repository');

// Services
const PaymentService = require('./services/payment.service');

// App
const createApp = require('./app');

const PORT = process.env.PORT || 3007;
const SERVICE_NAME = 'payment-service';

async function initDatabase(pool) {
  const initSql = fs.readFileSync(path.join(__dirname, 'db', 'init.sql'), 'utf8');
  await pool.query(initSql);
  logger.info('Database schema initialized for payments');
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
    const paymentRepo = new PaymentRepository(pool);
    const vnpayRepo = new VNPayRepository(pool);

    const paymentService = new PaymentService(paymentRepo, vnpayRepo, pool, eventBus);

    // 4. Create app (services injected, routes mounted inside app.js)
    const app = createApp({ paymentService });
    app.locals.db = pool;

    // 6. Start server
    const server = app.listen(PORT, () => {
      logger.info(`${SERVICE_NAME} running on port ${PORT}`);
    });

    // 7. Saga: Periodic VNPay timeout scanner (every 5 min)
    const TIMEOUT_MINUTES = parseInt(process.env.VNPAY_TIMEOUT_MINUTES) || 15;
    const SCAN_INTERVAL_MS = parseInt(process.env.VNPAY_SCAN_INTERVAL_MS) || 5 * 60 * 1000;

    const timeoutScanner = setInterval(async () => {
      try {
        const results = await paymentService.expireTimedOutPayments(TIMEOUT_MINUTES);
        if (results.length > 0) {
          logger.info({ count: results.length, results }, 'Expired timed-out VNPay payments');
        }
      } catch (err) {
        logger.error({ err }, 'VNPay timeout scanner error');
      }
    }, SCAN_INTERVAL_MS);

    logger.info({ intervalMs: SCAN_INTERVAL_MS, timeoutMinutes: TIMEOUT_MINUTES }, 'VNPay timeout scanner started');

    // 8. Saga §5.3: Outbox poller — CRITICAL: pass SERVICE_NAME for shared-DB isolation
    const outbox = require('../../../shared/outbox');
    const outboxPoller = outbox.startPoller(pool, eventBus, 3000, SERVICE_NAME);

    // Graceful shutdown
    const shutdown = async (signal) => {
      logger.info(`${signal} received, shutting down...`);
      clearInterval(timeoutScanner);
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
