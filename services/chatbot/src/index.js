const fs = require('fs');
const path = require('path');
const http = require('http');
const { Server: SocketIO } = require('socket.io');
const logger = require('../../../shared/common/logger');
const { createPool, closePool } = require('../../../shared/db');
const eventBus = require('../../../shared/event-bus');

// Repository
const ChatRepository = require('./repositories/chat.repository');

// Services
const ChatService = require('./services/chat.service');
const HFClient = require('./services/hf.client');
const ApiClient = require('./services/api.client');

// WebSocket
const initChatSocket = require('./ws/chat.handler');

const PORT = process.env.PORT || 3008;
const SERVICE_NAME = 'chatbot-service';

async function initDatabase(pool) {
  const initSql = fs.readFileSync(path.join(__dirname, 'db', 'init.sql'), 'utf8');
  await pool.query(initSql);
  logger.info('Database schema initialized for chatbot');
}

async function start() {
  try {
    // 1. Database
    const pool = createPool();
    await initDatabase(pool);
    logger.info('PostgreSQL connected');

    // 2. Event bus
    await eventBus.connect();
    logger.info('RabbitMQ connected');

    // 3. HF Inference Client
    const hfAccessToken = process.env.HF_ACCESS_TOKEN;
    if (!hfAccessToken) {
      logger.warn('HF_ACCESS_TOKEN not set — AI features will return fallback responses');
    }
    const hfModel = process.env.HF_MODEL || 'microsoft/Phi-3-mini-4k-instruct';
    const hfClient = new HFClient(hfAccessToken, hfModel);

    // 4. Internal API Client (service-to-service)
    const apiClient = new ApiClient();
    logger.info('Internal API client ready (Catalog, Inventory, Order)');

    // 5. Build dependency graph
    const chatRepo = new ChatRepository(pool);
    const chatService = new ChatService(chatRepo, hfClient, apiClient);

    // 6. Create Express app
    const createApp = require('./app');
    const app = createApp({ chatService });
    app.locals.db = pool;

    // 7. Create HTTP server + Socket.IO
    const server = http.createServer(app);
    const io = new SocketIO(server, {
      cors: {
        origin: process.env.CORS_ORIGIN || '*',
        methods: ['GET', 'POST']
      },
      path: '/ws/chat',
      pingTimeout: 60000,
      pingInterval: 25000
    });

    // 8. Initialize WebSocket handlers
    initChatSocket(io, chatService);
    logger.info('Socket.IO initialized on /ws/chat');

    // 9. Start server
    server.listen(PORT, () => {
      logger.info(`${SERVICE_NAME} running on port ${PORT} (HTTP + WebSocket)`);
    });

    // Graceful shutdown
    const shutdown = async (signal) => {
      logger.info(`${signal} received, shutting down...`);
      io.close();
      server.close();
      await eventBus.close();
      await closePool();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (err) {
    logger.error(err, 'Failed to start service');
    process.exit(1);
  }
}

start();
