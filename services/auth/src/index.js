const fs = require('fs');
const path = require('path');
const logger = require('../../../shared/common/logger');
const { createPool, closePool } = require('../../../shared/db');
const eventBus = require('../../../shared/event-bus');

// Repositories
const UserRepository = require('./repositories/user.repository');
const RoleRepository = require('./repositories/role.repository');
const EmployeeRepository = require('./repositories/employee.repository');
const CustomerRepository = require('./repositories/customer.repository');
const AuthRepository = require('./repositories/auth.repository');
const StoreRepository = require('./repositories/store.repository');

// Services
const AuthService = require('./services/auth.service');
const CustomerService = require('./services/customer.service');
const EmployeeService = require('./services/employee.service');
const RbacService = require('./services/rbac.service');
const StoreService = require('./services/store.service');
const PosAuthService = require('./services/posAuth.service');

const PORT = process.env.PORT || 3001;
const SERVICE_NAME = 'auth-service';

async function initDatabase(pool) {
  const initSql = fs.readFileSync(path.join(__dirname, 'db', 'init.sql'), 'utf8');
  await pool.query(initSql);
  logger.info('Database schema initialized');

  // Seed permissions + Super Admin role (idempotent — uses ON CONFLICT)
  const seedSql = fs.readFileSync(path.join(__dirname, 'db', 'seed.sql'), 'utf8');
  await pool.query(seedSql);
  logger.info('Seed data loaded (permissions + roles)');
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

    // 3. Build dependency graph (pool stays in index.js only)
    const userRepo = new UserRepository(pool);
    const roleRepo = new RoleRepository(pool);
    const employeeRepo = new EmployeeRepository(pool);
    const customerRepo = new CustomerRepository(pool);
    const authRepo = new AuthRepository(pool);
    const storeRepo = new StoreRepository(pool);

    const authService = new AuthService({ userRepo, authRepo, employeeRepo, customerRepo, roleRepo, storeRepo, pool });
    const customerService = new CustomerService({ customerRepo, userRepo, roleRepo, pool });
    const employeeService = new EmployeeService(employeeRepo, userRepo, authRepo, storeRepo, pool);
    const rbacService = new RbacService({ roleRepo });
    const storeService = new StoreService(storeRepo);
    const posAuthService = new PosAuthService({ authRepo, employeeRepo, userRepo });

    // 3b. Subscribe to domain events
    const EVENT = require('../../../shared/event-bus/eventTypes');

    await eventBus.subscribe(SERVICE_NAME, EVENT.ORDER_COMPLETED, async (message) => {
      try {
        const { customerId, items } = message.data || {};
        if (!customerId || !items?.length) {
          logger.warn({ messageId: message.id }, 'ORDER_COMPLETED: missing customerId or items');
          return;
        }

        // Calculate order total from items
        const orderTotal = items.reduce((sum, item) => {
          return sum + (item.quantity * item.unitPrice);
        }, 0);

        if (orderTotal <= 0) return;

        const updated = await customerRepo.incrementTotalSpent(customerId, orderTotal);
        if (updated) {
          logger.info(
            { customerId, orderTotal, newTotalSpent: updated.total_spent },
            'ORDER_COMPLETED: customer total_spent updated'
          );
        } else {
          logger.warn({ customerId }, 'ORDER_COMPLETED: customer not found');
        }
      } catch (err) {
        logger.error({ err, messageId: message.id }, 'ORDER_COMPLETED handler failed');
      }
    });
    logger.info('Subscribed to order.completed (customer total_spent sync)');

    // 4. Create app — pool does NOT leak to app/routes layer
    const createApp = require('./app');
    const app = createApp({ authService, customerService, employeeService, rbacService, storeService, posAuthService });
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
