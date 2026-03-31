const express = require('express');
const cache = require('../cache/redis');

function createHealthRouter() {
  const router = express.Router();

  router.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'statistics-service',
      timestamp: new Date().toISOString(),
      redis: cache.isConnected() ? 'connected' : 'disconnected'
    });
  });

  router.get('/ready', (req, res) => {
    if (!cache.isConnected()) {
      // Still ready — runs without cache, just slower
      return res.json({
        status: 'degraded',
        service: 'statistics-service',
        redis: 'disconnected'
      });
    }

    res.json({
      status: 'ok',
      service: 'statistics-service',
      redis: 'connected'
    });
  });

  return router;
}

module.exports = createHealthRouter;
