const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { errorHandler } = require('../../../shared/common/errors');
const healthRoutes = require('./routes/health.routes');

/**
 * Create Express app with dependency injection.
 * @param {object} deps - { chatService }
 */
function createApp({ chatService }) {
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

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
