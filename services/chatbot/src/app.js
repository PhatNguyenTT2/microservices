const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { errorHandler } = require('../../../shared/common/errors');
const healthRoutes = require('./routes/health.routes');

/**
 * Create Express app with dependency injection.
 * @param {object} deps - { chatService, knowledgeRepo, hybridService, pool, nightlyBatch }
 */
function createApp({ chatService, knowledgeRepo, hybridService, pool, nightlyBatch, weightLearner }) {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  // Rate limiter for chat endpoints (AI calls are expensive)
  const chatLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    message: { success: false, error: { message: 'Too many chat requests. Please wait a moment.', code: 'RATE_LIMITED' } }
  });

  // Health
  app.use('/', healthRoutes);

  // Chat API with rate limiting
  app.use('/api/chat', chatLimiter, require('./routes/chat.routes')(chatService));

  // Feedback API (Phase 3 — recommendation feedback loop)
  if (hybridService) {
    app.use('/api/chatbot', require('./routes/feedback.routes')(hybridService));
  }

  // RAG stats (for monitoring/debug)
  if (knowledgeRepo) {
    app.get('/api/rag/stats', async (req, res, next) => {
      try {
        const storeId = req.query.storeId ? parseInt(req.query.storeId) : null;
        const stats = await knowledgeRepo.getStats(storeId);
        res.json({ success: true, data: stats });
      } catch (err) {
        next(err);
      }
    });
  }

  // Phase 4: Monitoring & Observability API
  if (pool) {
    app.use('/api/chatbot', require('./routes/stats.routes')({ pool, hybridService, nightlyBatch, weightLearner }));
  }

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
