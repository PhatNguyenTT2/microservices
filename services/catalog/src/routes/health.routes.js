const router = require('express').Router();
const { checkHealth } = require('../../../../shared/db');

router.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'catalog-service', timestamp: new Date().toISOString() });
});

router.get('/ready', async (req, res) => {
  try {
    const dbStatus = await checkHealth(req.app.locals.db);
    res.json({ status: 'ready', service: 'catalog-service', dependencies: { postgres: dbStatus } });
  } catch (err) {
    res.status(503).json({ status: 'not_ready', service: 'catalog-service', error: err.message });
  }
});

module.exports = router;
