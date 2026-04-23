const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { errorHandler } = require('../../../shared/common/errors');
const healthRoutes = require('./routes/health.routes');

const { verifyToken } = require('../../../shared/auth-middleware');

/**
 * Create Express app with dependency injection.
 * @param {object} deps - { authService, customerService, employeeService, rbacService, storeService }
 */
function createApp({ authService, customerService, employeeService, rbacService, storeService, posAuthService }) {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  // Health
  app.use('/', healthRoutes);

  // API routes
  app.use('/api/auth', require('./routes/auth.routes')(authService));
  app.use('/api/customers', require('./routes/customer.routes')(customerService));
  app.use('/api/employees', require('./routes/employee.routes')(employeeService));
  app.use('/api/stores', require('./routes/store.routes')(storeService));
  app.use('/api', require('./routes/rbac.routes')(rbacService));
  app.use('/api/pos-auth', require('./routes/posAuth.routes')(posAuthService));

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
