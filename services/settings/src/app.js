const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { errorHandler } = require('../../../shared/common/errors');
const healthRoutes = require('./routes/health.routes');
const { verifyToken } = require('../../../shared/auth-middleware');

function createApp({ settingsService }) {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  app.use('/', healthRoutes);
  app.use('/api/settings', require('./routes/settings.routes')(settingsService));

  // Customer discount settings — standalone route for frontend compatibility
  app.get('/api/customer-discount-settings', verifyToken, async (req, res, next) => {
    try {
      const data = await settingsService.getCustomerDiscounts();
      res.json({ success: true, data });
    } catch (err) { next(err); }
  });

  // Runtime config — PUBLIC endpoint (no auth), returns app configuration
  app.get('/api/config', (req, res) => {
    res.json({
      apiUrl: '',
      socketUrl: '',
      environment: process.env.NODE_ENV || 'development',
      features: {
        vnpayEnabled: true,
        realTimeNotifications: true
      },
      settings: {
        notificationRefreshInterval: 300000,
        sessionTimeout: 3600000,
        toastDuration: 10000
      },
      timestamp: new Date().toISOString(),
      version: '1.0.0'
    });
  });

  // Internal service-to-service: Sales settings for promotion scheduler (no auth)
  // Only accessible within Docker network — gateway does NOT expose /api/internal/*
  app.get('/api/internal/sales-config', async (req, res, next) => {
    try {
      const data = await settingsService.getSalesSettings();
      res.json({ success: true, data });
    } catch (err) { next(err); }
  });

  // Internal service-to-service: Security settings for POS auth (no auth)
  app.get('/api/internal/security-config', async (req, res, next) => {
    try {
      const data = await settingsService.getSecuritySettings();
      res.json({ success: true, data });
    } catch (err) { next(err); }
  });

  app.use(errorHandler);

  return app;
}

module.exports = createApp;
