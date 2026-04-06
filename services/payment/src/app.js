const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { errorHandler } = require('../../../shared/common/errors');
const healthRoutes = require('./routes/health.routes');

function createApp({ paymentService }) {
  const app = express();

  app.use(helmet());
  const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173').split(',').map(o => o.trim());
  app.use(cors({ origin: allowedOrigins, credentials: true }));
  app.use(express.json());

  app.use('/', healthRoutes);

  app.use('/api/payments', require('./routes/payment.routes')(paymentService));

  app.use(errorHandler);

  return app;
}

module.exports = createApp;
