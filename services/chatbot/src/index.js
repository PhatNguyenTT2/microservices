const fs = require('fs');
const path = require('path');
const http = require('http');
const cron = require('node-cron');
const { Server: SocketIO } = require('socket.io');
const logger = require('../../../shared/common/logger');
const { createPool, closePool } = require('../../../shared/db');
const eventBus = require('../../../shared/event-bus');
const EVENT = require('../../../shared/event-bus/eventTypes');

// Repositories
const ChatRepository = require('./repositories/chat.repository');
const KnowledgeRepository = require('./repositories/knowledge.repository');
const CoPurchaseRepository = require('./repositories/copurchase.repository');

// Services
const ChatService = require('./services/chat.service');
const HFClient = require('./services/hf.client');
const ApiClient = require('./services/api.client');
const EmbeddingClient = require('./services/embedding.client');
const DataIngestionService = require('./services/data-ingestion.service');
const QueryReformulator = require('./services/query-reformulator');
const RAGService = require('./services/rag.service');

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
    const hfModel = process.env.HF_MODEL || 'Qwen/Qwen2.5-7B-Instruct';
    const hfClient = new HFClient(hfAccessToken, hfModel);

    // 4. Internal API Client (service-to-service)
    const apiClient = new ApiClient();
    logger.info('Internal API client ready (Catalog, Inventory, Order, Auth)');

    // 5. Embedding Client (Vietnamese SBERT — local ONNX)
    const embeddingClient = new EmbeddingClient();
    try {
      await embeddingClient.initialize();
    } catch (err) {
      logger.error({ err }, 'Embedding model failed to load — RAG will be disabled');
    }

    // 6. Build dependency graph
    const chatRepo = new ChatRepository(pool);
    const knowledgeRepo = new KnowledgeRepository(pool);
    const copurchaseRepo = new CoPurchaseRepository(pool);

    const dataIngestionService = new DataIngestionService(pool, embeddingClient, apiClient);
    const reformulator = new QueryReformulator(hfClient);

    // Phase 2: Collaborative Filtering
    const CollaborativeFilteringService = require('./services/cf.service');
    const cfService = new CollaborativeFilteringService(pool);

    // Phase 3: Hybrid Ensemble + Session Context + Weight Learning
    const HybridRecommendationService = require('./services/hybrid.service');
    const SessionContextService = require('./services/session-context.service');
    const WeightLearner = require('./services/weight-learner');

    const hybridService = new HybridRecommendationService({ copurchaseRepo, cfService, pool });
    const sessionContextService = new SessionContextService();
    const weightLearner = new WeightLearner(pool);

    let ragService = null;
    if (embeddingClient.isReady) {
      ragService = new RAGService({
        knowledgeRepo,
        copurchaseRepo,
        cfService,
        hybridService,
        sessionContextService,
        embeddingClient,
        hfClient,
        apiClient,
        reformulator
      });

      // Warm up hybrid cache (in-memory Apriori + CF similarities)
      hybridService.warmUp(1).catch(err => {
        logger.warn({ err }, 'Hybrid cache warmup failed — will use DB fallback');
      });

      logger.info('RAG Service initialized (Phase 3: Hybrid Ensemble + Session Context)');
    } else {
      logger.warn('RAG Service DISABLED — embedding model not loaded');
    }

    const chatService = new ChatService(chatRepo, hfClient, apiClient, ragService, copurchaseRepo);

    // Phase 4: Nightly Batch Pipeline
    const NightlyBatchPipeline = require('./jobs/nightly-batch');
    const nightlyBatch = new NightlyBatchPipeline({
      pool, hybridService, cfService, weightLearner, copurchaseRepo
    });

    // 7. Subscribe to events (for RAG data ingestion)
    if (embeddingClient.isReady) {
      await eventBus.subscribe(SERVICE_NAME, EVENT.PRODUCT_CREATED, async (message) => {
        await dataIngestionService.handleProductCreated(message);
      });

      await eventBus.subscribe(SERVICE_NAME, EVENT.PRODUCT_UPDATED, async (message) => {
        await dataIngestionService.handleProductUpdated(message);
      });

      await eventBus.subscribe(SERVICE_NAME, EVENT.PRODUCT_DELETED, async (message) => {
        await dataIngestionService.handleProductDeleted(message);
      });

      await eventBus.subscribe(SERVICE_NAME, EVENT.PRODUCT_PRICE_CHANGED, async (message) => {
        await dataIngestionService.handleProductUpdated(message);
      });

      await eventBus.subscribe(SERVICE_NAME, EVENT.INVENTORY_UPDATED, async (message) => {
        await dataIngestionService.handleInventoryUpdated(message);
      });

      await eventBus.subscribe(SERVICE_NAME, EVENT.ORDER_COMPLETED, async (message) => {
        await dataIngestionService.handleOrderCompleted(message);
      });

      // Phase 4 Task 5: Purchase event attribution tracking
      if (EVENT.ORDER_CONFIRMED) {
        await eventBus.subscribe(SERVICE_NAME, EVENT.ORDER_CONFIRMED, async (message) => {
          try {
            const { customerId, storeId, items } = message.data || {};
            if (!customerId || !items?.length) return;

            // Lookup products recommended in last 24h
            const { rows } = await pool.query(`
              SELECT DISTINCT product_id, source
              FROM recommendation_feedback
              WHERE user_id = $1 AND store_id = $2
                AND action = 'recommended'
                AND created_at > NOW() - INTERVAL '24 hours'
            `, [customerId, storeId]);

            if (rows.length === 0) return;

            const recommendedMap = new Map(rows.map(r => [Number(r.product_id), r.source]));

            let attributedCount = 0;
            for (const item of items) {
              const source = recommendedMap.get(Number(item.productId));
              if (source) {
                await hybridService.recordFeedback(
                  customerId, item.productId, storeId, source, 'purchased'
                );
                attributedCount++;
              }
            }

            if (attributedCount > 0) {
              logger.info({ customerId, storeId, attributedCount, totalItems: items.length },
                'Purchase attribution: matched recommended products');
            }
          } catch (err) {
            logger.warn({ err }, 'Purchase attribution tracking failed — non-critical');
          }
        });
        logger.info('Purchase attribution tracking registered (order.confirmed)');
      }

      logger.info('Event subscriptions registered (product.*, inventory.updated, order.completed)');

      // 8. Cron fallback: full sync every 30 minutes
      cron.schedule('*/30 * * * *', async () => {
        logger.info('Cron: Starting scheduled full sync...');
        try {
          const result = await dataIngestionService.syncAll();
          logger.info(result, 'Cron: Full sync completed');
        } catch (err) {
          logger.error({ err }, 'Cron: Full sync failed');
        }
      });
      logger.info('Cron scheduled: full sync every 30 minutes');

      // Phase 4: Nightly batch pipeline (Apriori → CF → Weights → Warmup)
      if (process.env.ENABLE_CRON !== 'false') {
        nightlyBatch.start('0 2 * * *');
      }

      // Initial sync on startup (after 10s delay to let other services start)
      setTimeout(async () => {
        try {
          logger.info('Startup: Running initial data sync...');
          const result = await dataIngestionService.syncAll();
          logger.info(result, 'Startup: Initial sync completed');
        } catch (err) {
          logger.error({ err }, 'Startup: Initial sync failed (will retry at next cron)');
        }
      }, 10_000);
    }

    // 9. Create Express app
    const createApp = require('./app');
    const app = createApp({ chatService, knowledgeRepo, hybridService, pool, nightlyBatch, weightLearner });
    app.locals.db = pool;

    // 10. Create HTTP server + Socket.IO
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

    // 11. Initialize WebSocket handlers
    initChatSocket(io, chatService);
    logger.info('Socket.IO initialized on /ws/chat');

    // 12. Start server
    server.listen(PORT, () => {
      logger.info(`${SERVICE_NAME} running on port ${PORT} (HTTP + WebSocket + RAG)`);
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
