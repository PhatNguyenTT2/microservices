const router = require('express').Router();
const { checkHealth } = require('../../../../shared/db');

/**
 * GET /health
 * Basic health check — returns immediately.
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'settings-service',
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /ready
 * Readiness check — verifies PostgreSQL connection.
 */
router.get('/ready', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const dbStatus = await checkHealth(db);
    res.json({
      status: 'ready',
      service: 'settings-service',
      dependencies: { postgres: dbStatus }
    });
  } catch (err) {
    res.status(503).json({
      status: 'not_ready',
      service: 'settings-service',
      error: err.message
    });
  }
});

module.exports = router;
