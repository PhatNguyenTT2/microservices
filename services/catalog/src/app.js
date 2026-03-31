const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { errorHandler } = require('../../../shared/common/errors');
const healthRoutes = require('./routes/health.routes');

/**
 * Create Express app with dependency injection.
 * @param {object} deps - { categoryService, productService }
 */
function createApp({ categoryService, productService }) {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  // Health
  app.use('/', healthRoutes);

  // API routes
  app.use('/api/categories', require('./routes/category.routes')(categoryService));
  app.use('/api/products', require('./routes/product.routes')(productService));

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
