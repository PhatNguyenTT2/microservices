const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const createStatisticsRouter = require('./routes/statistics.routes');
const createHealthRouter = require('./routes/health.routes');

function createApp({ statisticsService }) {
  const app = express();

  app.use(cors());
  app.use(helmet());
  app.use(express.json());

  // Health & Readiness
  const healthRouter = createHealthRouter();
  app.use('/', healthRouter);

  // Statistics API
  const statisticsRouter = createStatisticsRouter(statisticsService);
  app.use('/api/statistics', statisticsRouter);

  // Global error handler
  app.use((err, req, res, next) => {
    const status = err.statusCode || 500;
    res.status(status).json({
      success: false,
      error: err.message || 'Internal server error'
    });
  });

  return app;
}

module.exports = createApp;
