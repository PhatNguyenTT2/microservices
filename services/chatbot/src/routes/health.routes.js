const router = require('express').Router();
const { checkHealth } = require('../../../../shared/db');

router.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'chatbot-service', timestamp: new Date().toISOString() });
});

router.get('/ready', async (req, res) => {
  try {
    const dbStatus = await checkHealth(req.app.locals.db);
    res.json({ 
      status: 'ready', 
      service: 'chatbot-service',
      dependencies: { 
        postgres: dbStatus,
        hf_model: process.env.HF_MODEL || 'microsoft/Phi-3-mini-4k-instruct' 
      }
    });
  } catch (err) {
    res.status(503).json({ status: 'not_ready', service: 'chatbot-service', error: err.message });
  }
});

module.exports = router;

