const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { errorHandler } = require('../../../shared/common/errors');
const healthRoutes = require('./routes/health.routes');

/**
 * Create Express app with dependency injection.
 * @param {object} deps - { chatService, knowledgeRepo }
 */
function createApp({ chatService, knowledgeRepo }) {
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

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
