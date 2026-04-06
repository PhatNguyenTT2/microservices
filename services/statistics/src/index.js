const logger = require('../../../shared/common/logger');
const eventBus = require('../../../shared/event-bus');
const EVENT = require('../../../shared/event-bus/eventTypes');
const cache = require('./cache/redis');

// Clients
const OrderClient = require('./clients/order.client');
const CatalogClient = require('./clients/catalog.client');
const AuthClient = require('./clients/auth.client');

// Services
const StatisticsService = require('./services/statistics.service');

const PORT = process.env.PORT || 3009;
const SERVICE_NAME = 'statistics-service';

async function start() {
  try {
    // 1. Redis
    await cache.connect(process.env.REDIS_URL || 'redis://localhost:6379');

    // 2. Event bus
    await eventBus.connect();
    logger.info('RabbitMQ connected');

    // 3. Build internal service clients
    const orderClient = new OrderClient(process.env.ORDER_SERVICE_URL || 'http://order:3003');
    const catalogClient = new CatalogClient(process.env.CATALOG_SERVICE_URL || 'http://catalog:3002');
    const authClient = new AuthClient(process.env.AUTH_SERVICE_URL || 'http://auth:3001');

    // 4. Build service
    const statisticsService = new StatisticsService({ orderClient, catalogClient, authClient });

    // 5. Subscribe to cache invalidation events
    await eventBus.subscribe(SERVICE_NAME, EVENT.ORDER_SHIPPING, async () => {
      logger.info('order.shipping → invalidating dashboard cache');
      await cache.invalidate('stats:dashboard:*');
      await cache.invalidate('stats:sales:*');
    });

    await eventBus.subscribe(SERVICE_NAME, EVENT.PAYMENT_COMPLETED, async () => {
      logger.info('payment.completed → invalidating dashboard cache');
      await cache.invalidate('stats:dashboard:*');
      await cache.invalidate('stats:sales:*');
    });

    await eventBus.subscribe(SERVICE_NAME, EVENT.INVENTORY_UPDATED, async () => {
      logger.info('inventory.updated → invalidating inventory cache');
      await cache.invalidate('stats:inventory:*');
    });

    // 6. Create Express app
    const createApp = require('./app');
    const app = createApp({ statisticsService });

    // 7. Start server
    const server = app.listen(PORT, () => {
      logger.info(`${SERVICE_NAME} running on port ${PORT}`);
    });

    // Graceful shutdown
    const shutdown = async (signal) => {
      logger.info(`${signal} received, shutting down...`);
      server.close();
      await eventBus.close();
      await cache.close();
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
