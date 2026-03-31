const router = require('express').Router();
const { checkHealth } = require('../../../../shared/db');

router.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'payment-service', timestamp: new Date().toISOString() });
});

router.get('/ready', async (req, res) => {
  try {
    const dbStatus = await checkHealth(req.app.locals.db);
    res.json({ status: 'ready', service: 'payment-service', dependencies: { postgres: dbStatus } });
  } catch (err) {
    res.status(503).json({ status: 'not_ready', service: 'payment-service', error: err.message });
  }
});

module.exports = router;
