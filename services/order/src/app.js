const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { errorHandler } = require('../../../shared/common/errors');
const healthRoutes = require('./routes/health.routes');

function createApp({ orderService, orderDetailRepo }) {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  app.use('/', healthRoutes);

  app.use('/api/orders', require('./routes/order.routes')(orderService));
  app.use('/api/order-details', require('./routes/order-detail.routes')(orderService, orderDetailRepo));

  app.use(errorHandler);

  return app;
}

module.exports = createApp;
