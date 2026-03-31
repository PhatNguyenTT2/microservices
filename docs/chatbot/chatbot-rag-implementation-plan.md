# KẾ HOẠCH TRIỂN KHAI CHI TIẾT: CHATBOT RAG RECOMMENDATION

**Dự án:** POSMART — Hệ thống Quản lý Chuỗi Siêu thị Mini  
**Module:** Service 8 (AI Chatbot — Port 3008)  
**Ngày lập:** 2026-03-31  
**Kiến trúc:** Retrieval-Augmented Generation (RAG) + Metadata Filtering  

---

## QUYẾT ĐỊNH KỸ THUẬT ĐÃ CHỐT

| # | Quyết định | Lựa chọn |
|---|-----------|----------|
| 1 | Embedding model | `keepitreal/vietnamese-sbert` (768 dim) via `@xenova/transformers` local |
| 2 | Đồng bộ dữ liệu Phase 1 | **Cron polling 15 phút** (HTTP pull từ Catalog + Inventory) |
| 3 | Catalog events | Defer — Phase 2 mới bổ sung event publishing |
| 4 | Scope Phase 1 | Product Recommendation via Vector Search only |
| 5 | pgvector installation | Đổi Docker image → `pgvector/pgvector:pg16` |

---

## TỔNG QUAN CÁC PHASE

```
Phase 1: RAG Foundation ──────────────────── (Core)
  ├── Step 1.1: Infrastructure (pgvector + Docker)
  ├── Step 1.2: Database Schema (product_knowledge_base)
  ├── Step 1.3: Embedding Client (@xenova/transformers)
  ├── Step 1.4: Data Ingestion Pipeline (Cron 15 phút)
  ├── Step 1.5: RAG Query Flow (Vector Search + LLM)
  └── Step 1.6: Tích hợp vào ChatService + Intent System

Phase 2: Enhancement ─────────────────────── (Future)
  ├── Step 2.1: Event-driven Sync (Catalog publish + Chatbot subscribe)
  ├── Step 2.2: Personalization (customer_type + total_spent)
  └── Step 2.3: Co-purchase Recommendation (sale_order_detail analysis)
```

---

## PHASE 1: RAG FOUNDATION (CORE)

### Step 1.1 — Infrastructure: pgvector + Docker Image

**Mục tiêu:** PostgreSQL hỗ trợ kiểu dữ liệu `VECTOR(768)` và HNSW index.

#### [MODIFY] `docker-compose.yml`

Thay đổi Docker image PostgreSQL:

```diff
  postgres:
-   image: postgres:16-alpine
+   image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: posmart
      POSTGRES_PASSWORD: posmart_secret
      POSTGRES_DB: auth_db
```

> **Lý do:** `pgvector/pgvector:pg16` là image chính thức của pgvector, build trên PostgreSQL 16, nhẹ và ổn định. Image `ankane/pgvector` cũng hoạt động nhưng `pgvector/pgvector` được cộng đồng khuyên dùng hơn.

#### [MODIFY] `docker-compose.override.yml`

Áp dụng thay đổi tương tự nếu file override cũng khai báo postgres image.

#### [MODIFY] `docker-compose.supabase.yml`

Áp dụng thay đổi tương tự nếu file supabase cũng khai báo postgres image.

#### Verification

```bash
docker compose up -d postgres
docker exec -it <postgres_container> psql -U posmart -d chatbot_db -c "CREATE EXTENSION IF NOT EXISTS vector; SELECT extversion FROM pg_extension WHERE extname = 'vector';"
# Expected: extversion = 0.7.x
```

---

### Step 1.2 — Database Schema: product_knowledge_base

**Mục tiêu:** Tạo bảng vector store trong `chatbot_db`.

#### [MODIFY] `services/chatbot/src/db/init.sql`

Thêm vào cuối file `init.sql` hiện tại:

```sql
-- ============================================================
-- RAG: Product Knowledge Base (Vector Store)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS product_knowledge_base (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,

    -- Tham chiếu cross-service (không FK vì khác DB)
    product_id BIGINT NOT NULL,              -- Ref → catalog_db.product.id
    store_id BIGINT NOT NULL,                -- Ref → auth_db.store.id

    -- Content & Embedding
    content TEXT NOT NULL,                   -- Text đã format (tên + giá + danh mục + tồn kho)
    embedding VECTOR(768),                   -- Vietnamese-SBERT 768 dimensions

    -- Metadata cho filtering
    category_name TEXT,                      -- Cache tên danh mục (tránh cross-service query)
    unit_price NUMERIC DEFAULT 0,            -- Cache giá bán (ưu tiên batch price)
    is_in_stock BOOLEAN DEFAULT TRUE,        -- Còn hàng hay không
    quantity_on_shelf INT DEFAULT 0,         -- Số lượng trên kệ

    -- Timestamps
    last_synced_at TIMESTAMPTZ DEFAULT NOW(),

    -- Unique constraint: 1 product chỉ có 1 record per store
    UNIQUE (product_id, store_id)
);

-- HNSW Index cho vector search (cosine similarity) — tối ưu cho RAG queries
CREATE INDEX IF NOT EXISTS idx_pkb_embedding
    ON product_knowledge_base
    USING hnsw (embedding vector_cosine_ops);

-- B-Tree indexes cho metadata filtering
CREATE INDEX IF NOT EXISTS idx_pkb_store_id
    ON product_knowledge_base(store_id);

CREATE INDEX IF NOT EXISTS idx_pkb_store_stock
    ON product_knowledge_base(store_id, is_in_stock)
    WHERE is_in_stock = TRUE;

CREATE INDEX IF NOT EXISTS idx_pkb_product_store
    ON product_knowledge_base(product_id, store_id);

-- ============================================================
-- Idempotency: Processed Events (theo pattern của inventory/order)
-- ============================================================

CREATE TABLE IF NOT EXISTS processed_events (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    processed_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Giải thích thiết kế:**

| Cột | Lý do |
|-----|-------|
| `content` | Text gộp dùng để sinh embedding — khi query, vector search so sánh trên cột này |
| `embedding VECTOR(768)` | Khớp với output dimension của `keepitreal/vietnamese-sbert` |
| `category_name`, `unit_price` | Cache metadata — tránh gọi HTTP cross-service khi trả response |
| `is_in_stock` + `quantity_on_shelf` | Metadata filtering để chỉ gợi ý hàng còn trên kệ |
| `UNIQUE (product_id, store_id)` | Mỗi sản phẩm chỉ có 1 record per store — UPSERT khi sync |
| `HNSW index` | Nhanh hơn IVFFlat cho dataset nhỏ-trung bình (< 1M rows) |

#### [MODIFY] `supabase_init_all.sql`

Thêm block tương tự vào cuối section "Service 8: AI Chatbot" trong file init tổng hợp.

---

### Step 1.3 — Embedding Client: `@xenova/transformers`

**Mục tiêu:** Chạy `keepitreal/vietnamese-sbert` local (không cần GPU, không tốn API credit).

#### [NEW] `services/chatbot/src/services/embedding.client.js`

```javascript
/**
 * EmbeddingClient — Local Vietnamese SBERT via @xenova/transformers
 * Model: keepitreal/vietnamese-sbert (768 dimensions)
 * Runs on CPU — no GPU required
 */
const { pipeline } = require('@xenova/transformers');
const logger = require('../../../../shared/common/logger');

class EmbeddingClient {
    constructor(modelName = 'keepitreal/vietnamese-sbert') {
        this.modelName = modelName;
        this.extractor = null;
        this.isReady = false;
    }

    /**
     * Warm up: tải model lần đầu (cache lại cho lần sau)
     * Gọi 1 lần khi service start
     */
    async initialize() {
        const startTime = Date.now();
        logger.info({ model: this.modelName }, 'Loading embedding model...');

        this.extractor = await pipeline(
            'feature-extraction',
            this.modelName,
            { quantized: true }   // Dùng quantized model cho nhẹ hơn
        );

        this.isReady = true;
        const loadMs = Date.now() - startTime;
        logger.info({ model: this.modelName, loadMs }, 'Embedding model loaded');
    }

    /**
     * Sinh embedding vector cho 1 đoạn text
     * @param {string} text - Nội dung cần embed
     * @returns {number[]} - Mảng 768 chiều
     */
    async embed(text) {
        if (!this.isReady) throw new Error('Embedding model not initialized');

        const startTime = Date.now();
        const output = await this.extractor(text, {
            pooling: 'mean',
            normalize: true
        });

        const vector = Array.from(output.data);
        const latencyMs = Date.now() - startTime;

        logger.debug({ textLength: text.length, vectorDim: vector.length, latencyMs }, 'Text embedded');
        return vector;
    }

    /**
     * Sinh embedding cho nhiều text cùng lúc (batch)
     * @param {string[]} texts
     * @returns {number[][]}
     */
    async embedBatch(texts) {
        if (!this.isReady) throw new Error('Embedding model not initialized');

        const startTime = Date.now();
        const vectors = [];

        // Sequential để tránh OOM trên CPU
        for (const text of texts) {
            const output = await this.extractor(text, {
                pooling: 'mean',
                normalize: true
            });
            vectors.push(Array.from(output.data));
        }

        const latencyMs = Date.now() - startTime;
        logger.info({ batchSize: texts.length, latencyMs }, 'Batch embedding completed');
        return vectors;
    }
}

module.exports = EmbeddingClient;
```

#### [MODIFY] `services/chatbot/package.json`

Thêm dependencies mới:

```diff
  "dependencies": {
    "@huggingface/inference": "^3.6.0",
+   "@xenova/transformers": "^2.17.0",
+   "pgvector": "^0.2.0",
+   "node-cron": "^3.0.3",
    "cors": "^2.8.5",
```

> **Lý do chọn `@xenova/transformers`:** Chạy inference hoàn toàn trên Node.js (ONNX Runtime), không cần Python hay GPU. Model được cache sau lần tải đầu tiên.

---

### Step 1.4 — Data Ingestion Pipeline (Cron 15 phút)

**Mục tiêu:** Tự động kéo dữ liệu từ Catalog + Inventory, sinh embedding, lưu vào `product_knowledge_base`.

#### [NEW] `services/chatbot/src/services/data-ingestion.service.js`

```javascript
/**
 * DataIngestionService — Cron-based RAG Data Pipeline
 * Chạy mỗi 15 phút: Pull Catalog + Inventory → Embed → Upsert knowledge base
 */
const logger = require('../../../../shared/common/logger');

class DataIngestionService {
    constructor(pool, embeddingClient, apiClient) {
        this.pool = pool;
        this.embeddingClient = embeddingClient;
        this.apiClient = apiClient;
    }

    /**
     * Main pipeline: Sync toàn bộ sản phẩm cho tất cả stores
     */
    async syncAll() {
        const startTime = Date.now();
        logger.info('RAG Data Ingestion: Starting full sync...');

        try {
            // 1. Lấy danh sách stores (từ Auth service hoặc config)
            const storeIds = await this._getStoreIds();

            // 2. Lấy toàn bộ sản phẩm từ Catalog (centralized)
            const productsResult = await this.apiClient.getAllProducts();
            if (!productsResult.success || !productsResult.data?.products?.length) {
                logger.warn('No products found from Catalog — skipping sync');
                return { synced: 0, skipped: 0 };
            }
            const products = productsResult.data.products;

            let synced = 0;
            let skipped = 0;

            // 3. Với mỗi store, lấy inventory và upsert knowledge base
            for (const storeId of storeIds) {
                const inventoryResult = await this.apiClient.getStoreInventory(storeId);
                const inventoryMap = this._buildInventoryMap(inventoryResult);

                for (const product of products) {
                    try {
                        // Chỉ sync sản phẩm đang active
                        if (!product.isActive && product.isActive !== undefined) {
                            skipped++;
                            continue;
                        }

                        const inventory = inventoryMap.get(String(product.id)) || null;
                        await this._upsertProductKnowledge(product, storeId, inventory);
                        synced++;
                    } catch (err) {
                        logger.error({ err, productId: product.id, storeId }, 'Failed to sync product');
                        skipped++;
                    }
                }
            }

            const durationMs = Date.now() - startTime;
            logger.info({ synced, skipped, storeCount: storeIds.length, durationMs },
                'RAG Data Ingestion: Sync completed');

            return { synced, skipped, durationMs };
        } catch (err) {
            logger.error({ err }, 'RAG Data Ingestion: Sync failed');
            throw err;
        }
    }

    /**
     * Lấy danh sách store IDs
     * Phase 1: Hardcode hoặc query từ config
     * Phase 2: Gọi Auth service GET /api/stores
     */
    async _getStoreIds() {
        // Thử lấy từ Auth service
        try {
            const result = await this.apiClient.getStores();
            if (result.success && result.data?.length) {
                return result.data.map(s => s.id);
            }
        } catch (err) {
            logger.warn({ err }, 'Failed to fetch stores — using fallback');
        }

        // Fallback: lấy unique store_ids đã có trong knowledge base
        const { rows } = await this.pool.query(
            'SELECT DISTINCT store_id FROM product_knowledge_base'
        );
        if (rows.length > 0) return rows.map(r => r.store_id);

        // Default fallback
        return [1];
    }

    /**
     * Build inventory lookup map: productId → { totalOnShelf, isInStock }
     */
    _buildInventoryMap(inventoryResult) {
        const map = new Map();
        if (!inventoryResult?.success || !inventoryResult.data) return map;

        const items = Array.isArray(inventoryResult.data)
            ? inventoryResult.data
            : inventoryResult.data.summary || [];

        for (const item of items) {
            const productId = String(item.product_id);
            const totalOnShelf = parseInt(item.total_on_shelf || item.totalOnShelf || 0);
            map.set(productId, {
                totalOnShelf,
                totalOnHand: parseInt(item.total_on_hand || item.totalOnHand || 0),
                isInStock: totalOnShelf > 0
            });
        }
        return map;
    }

    /**
     * Format content → Embed → Upsert vào product_knowledge_base
     */
    async _upsertProductKnowledge(product, storeId, inventory) {
        // 1. Xây dựng content text cho embedding
        const isInStock = inventory ? inventory.isInStock : false;
        const qtyOnShelf = inventory ? inventory.totalOnShelf : 0;
        const price = product.unitPrice || 0;
        const categoryName = product.categoryName || product.category?.name || 'Chưa phân loại';

        const content = this._buildContentText(product, categoryName, price, isInStock, qtyOnShelf);

        // 2. Sinh embedding vector
        const embedding = await this.embeddingClient.embed(content);

        // 3. Upsert vào database (pgvector format)
        const vectorStr = `[${embedding.join(',')}]`;

        await this.pool.query(`
            INSERT INTO product_knowledge_base
                (product_id, store_id, content, embedding, category_name, unit_price, is_in_stock, quantity_on_shelf, last_synced_at)
            VALUES ($1, $2, $3, $4::vector, $5, $6, $7, $8, NOW())
            ON CONFLICT (product_id, store_id)
            DO UPDATE SET
                content = EXCLUDED.content,
                embedding = EXCLUDED.embedding,
                category_name = EXCLUDED.category_name,
                unit_price = EXCLUDED.unit_price,
                is_in_stock = EXCLUDED.is_in_stock,
                quantity_on_shelf = EXCLUDED.quantity_on_shelf,
                last_synced_at = NOW()
        `, [product.id, storeId, content, vectorStr, categoryName, price, isInStock, qtyOnShelf]);
    }

    /**
     * Template content cho embedding
     * Được thiết kế tối ưu cho Vietnamese SBERT semantic search
     */
    _buildContentText(product, categoryName, price, isInStock, qtyOnShelf) {
        const parts = [
            `Sản phẩm "${product.name}"`,
            `danh mục "${categoryName}"`,
            `giá ${Number(price).toLocaleString('vi-VN')} VND`,
        ];

        if (product.vendor) {
            parts.push(`nhà cung cấp "${product.vendor}"`);
        }

        if (isInStock) {
            parts.push(`hiện còn ${qtyOnShelf} sản phẩm trên kệ`);
        } else {
            parts.push(`hiện đã hết hàng`);
        }

        return parts.join(', ') + '.';
    }
}

module.exports = DataIngestionService;
```

#### [MODIFY] `services/chatbot/src/services/api.client.js`

Thêm các method mới cho Data Ingestion:

```javascript
// ── Thêm vào class ApiClient ────────────────────

// Lấy toàn bộ sản phẩm (không phân trang — cho ingestion)
async getAllProducts() {
    const url = `${SERVICE_URLS.catalog}/api/products`;
    return this._fetch(url);
}

// Lấy inventory summary theo store
async getStoreInventory(storeId) {
    const url = `${SERVICE_URLS.inventory}/api/inventory/summary?storeId=${storeId}`;
    return this._fetch(url);
}

// Lấy danh sách stores
async getStores() {
    const authUrl = process.env.AUTH_SERVICE_URL || 'http://auth:3001';
    const url = `${authUrl}/api/stores`;
    return this._fetch(url);
}
```

#### Cron Integration — [MODIFY] `services/chatbot/src/index.js`

Thêm cron job khi service start:

```javascript
// Thêm sau dòng: const chatService = new ChatService(...)

// 5.5 Data Ingestion (RAG pipeline)
const DataIngestionService = require('./services/data-ingestion.service');
const EmbeddingClient = require('./services/embedding.client');
const cron = require('node-cron');

const embeddingClient = new EmbeddingClient('keepitreal/vietnamese-sbert');
const ingestionService = new DataIngestionService(pool, embeddingClient, apiClient);

// Khởi tạo embedding model (async — không block startup)
embeddingClient.initialize()
    .then(() => {
        logger.info('Embedding model ready — starting initial sync');
        // Sync lần đầu sau khi model load xong
        return ingestionService.syncAll();
    })
    .then(result => {
        logger.info(result, 'Initial RAG data sync completed');
    })
    .catch(err => {
        logger.error({ err }, 'Initial RAG sync failed — will retry on cron');
    });

// Cron: chạy mỗi 15 phút
cron.schedule('*/15 * * * *', async () => {
    if (!embeddingClient.isReady) {
        logger.warn('Embedding model not ready — skipping scheduled sync');
        return;
    }
    try {
        const result = await ingestionService.syncAll();
        logger.info(result, 'Scheduled RAG sync completed');
    } catch (err) {
        logger.error({ err }, 'Scheduled RAG sync failed');
    }
});
```

---

### Step 1.5 — RAG Query Flow: Vector Search + LLM

**Mục tiêu:** Nhận câu hỏi user → embed → vector search → gửi kết quả cho LLM → trả response.

#### [NEW] `services/chatbot/src/repositories/knowledge.repository.js`

```javascript
/**
 * KnowledgeRepository — pgvector search operations
 * Quản lý product_knowledge_base
 */
class KnowledgeRepository {
    constructor(pool) {
        this.pool = pool;
    }

    /**
     * Vector similarity search với metadata filtering
     * @param {number[]} queryVector - Embedding vector câu hỏi user
     * @param {number} storeId - Store ID để lọc multi-tenancy
     * @param {object} options - { limit, inStockOnly }
     * @returns {Array} Top-K matching products
     */
    async searchSimilar(queryVector, storeId, options = {}) {
        const { limit = 5, inStockOnly = true } = options;
        const vectorStr = `[${queryVector.join(',')}]`;

        let query = `
            SELECT
                product_id,
                store_id,
                content,
                category_name,
                unit_price,
                is_in_stock,
                quantity_on_shelf,
                1 - (embedding <=> $1::vector) AS similarity_score
            FROM product_knowledge_base
            WHERE store_id = $2
        `;
        const params = [vectorStr, storeId];

        if (inStockOnly) {
            query += ` AND is_in_stock = TRUE`;
        }

        params.push(limit);
        query += ` ORDER BY embedding <=> $1::vector ASC LIMIT $${params.length}`;

        const { rows } = await this.pool.query(query, params);
        return rows;
    }

    /**
     * Lấy thông tin knowledge base stats
     */
    async getStats(storeId) {
        const { rows } = await this.pool.query(`
            SELECT
                COUNT(*) AS total_products,
                COUNT(*) FILTER (WHERE is_in_stock = TRUE) AS in_stock_count,
                MIN(last_synced_at) AS oldest_sync,
                MAX(last_synced_at) AS latest_sync
            FROM product_knowledge_base
            WHERE store_id = $1
        `, [storeId]);
        return rows[0];
    }
}

module.exports = KnowledgeRepository;
```

#### [NEW] `services/chatbot/src/services/rag.service.js`

```javascript
/**
 * RAGService — Orchestrates the full RAG pipeline
 * Query embedding → Vector search → Context building → LLM generation
 */
const logger = require('../../../../shared/common/logger');

class RAGService {
    constructor(knowledgeRepo, embeddingClient, hfClient) {
        this.knowledgeRepo = knowledgeRepo;
        this.embeddingClient = embeddingClient;
        this.hfClient = hfClient;
    }

    /**
     * Xử lý recommendation query
     * @param {string} userMessage - Câu hỏi gốc
     * @param {number} storeId - Store context
     * @param {Array} chatHistory - Lịch sử chat gần nhất
     * @returns {{ content, productIds, model, latencyMs }}
     */
    async recommend(userMessage, storeId, chatHistory = []) {
        const startTime = Date.now();

        // 1. Embed user query
        if (!this.embeddingClient.isReady) {
            return {
                content: 'Hệ thống gợi ý đang khởi tạo, vui lòng thử lại sau giây lát.',
                productIds: [],
                model: null,
                latencyMs: Date.now() - startTime
            };
        }

        const queryVector = await this.embeddingClient.embed(userMessage);

        // 2. Vector search với metadata filtering
        if (!storeId) {
            logger.warn('No storeId for RAG recommendation — returning general response');
            return this._fallbackNoStore(userMessage, startTime);
        }

        const results = await this.knowledgeRepo.searchSimilar(queryVector, storeId, {
            limit: 5,
            inStockOnly: true
        });

        if (results.length === 0) {
            return this._fallbackNoResults(userMessage, storeId, startTime);
        }

        // 3. Build context cho LLM
        const productContext = results.map((r, i) =>
            `${i + 1}. ${r.content} (Điểm phù hợp: ${(r.similarity_score * 100).toFixed(1)}%)`
        ).join('\n');

        const productIds = results.map(r => r.product_id);

        // 4. LLM Generation: Augmented prompt
        const augmentedMessages = [
            ...chatHistory.map(m => ({ role: m.role, content: m.content })),
            {
                role: 'user',
                content: `${userMessage}\n\n[DATA - Sản phẩm phù hợp tại chi nhánh hiện tại]\n${productContext}\n\n` +
                    `Dựa trên danh sách sản phẩm trên, hãy gợi ý cho khách một cách tự nhiên, thân thiện. ` +
                    `Nêu rõ tên sản phẩm, giá, và tình trạng tồn kho. ` +
                    `Nếu có sản phẩm liên quan, khuyến khích khách mua thêm.`
            }
        ];

        const aiResponse = await this.hfClient.chatCompletion(augmentedMessages);
        const latencyMs = Date.now() - startTime;

        logger.info({
            storeId,
            resultCount: results.length,
            topScore: results[0]?.similarity_score,
            latencyMs
        }, 'RAG recommendation completed');

        return {
            content: aiResponse.content,
            productIds,
            products: results.map(r => ({
                productId: r.product_id,
                name: r.content.match(/"([^"]+)"/)?.[1] || 'Unknown',
                price: r.unit_price,
                categoryName: r.category_name,
                quantityOnShelf: r.quantity_on_shelf,
                similarityScore: r.similarity_score
            })),
            model: aiResponse.model,
            latencyMs,
            apiCalled: 'rag:vector_search'
        };
    }

    _fallbackNoStore(userMessage, startTime) {
        return {
            content: 'Để gợi ý sản phẩm chính xác, mình cần biết bạn đang mua tại chi nhánh nào. ' +
                     'Bạn có thể cho mình biết không?',
            productIds: [],
            model: null,
            latencyMs: Date.now() - startTime
        };
    }

    _fallbackNoResults(userMessage, storeId, startTime) {
        return {
            content: `Xin lỗi, mình chưa tìm thấy sản phẩm phù hợp với yêu cầu "${userMessage}" ` +
                     `tại chi nhánh hiện tại. Bạn có thể mô tả chi tiết hơn được không?`,
            productIds: [],
            model: null,
            latencyMs: Date.now() - startTime
        };
    }
}

module.exports = RAGService;
```

---

### Step 1.6 — Tích hợp vào ChatService + Intent System

**Mục tiêu:** Thêm intent `RECOMMENDATION` và kết nối RAGService vào luồng chính.

#### [MODIFY] `services/chatbot/src/services/intent.resolver.js`

Thêm intent mới:

```diff
  const INTENT_PATTERNS = {
+     RECOMMENDATION: {
+         keywords: [
+             'gợi ý', 'recommend', 'đề xuất', 'tư vấn',
+             'nên mua', 'mua gì', 'có gì ngon', 'có gì hay',
+             'phù hợp', 'suggest', 'giới thiệu', 'best seller'
+         ],
+         description: 'Gợi ý sản phẩm (RAG Recommendation)'
+     },
      CHECK_STOCK: {
```

> **Lưu ý:** `RECOMMENDATION` phải được đặt TRƯỚC `SEARCH_PRODUCT` trong object vì `resolveIntent()` dùng `Object.entries()` — first match wins. Keyword "gợi ý" hiện thuộc `SEARCH_PRODUCT` → cần chuyển sang `RECOMMENDATION`.

#### [MODIFY] `services/chatbot/src/services/chat.service.js`

1. **Inject RAGService vào constructor:**

```diff
  class ChatService {
-     constructor(chatRepo, hfClient, apiClient = null) {
+     constructor(chatRepo, hfClient, apiClient = null, ragService = null) {
          this.chatRepo = chatRepo;
          this.hfClient = hfClient;
          this.apiClient = apiClient;
+         this.ragService = ragService;
      }
```

2. **Thêm case vào switch intent:**

```diff
          switch (intentResult.intent) {
+             case 'RECOMMENDATION':
+                 response = await this._handleRecommendation(sessionId, userMessage);
+                 break;
              case 'CHECK_STOCK':
```

3. **Thêm handler method:**

```javascript
async _handleRecommendation(sessionId, userMessage) {
    // Nếu RAG chưa sẵn sàng, fallback về search thường
    if (!this.ragService) {
        return this._handleSearchProduct(sessionId, userMessage);
    }

    const session = await this.chatRepo.findSessionById(sessionId);
    const chatHistory = await this.chatRepo.getRecentContext(sessionId, 5);

    const result = await this.ragService.recommend(
        userMessage,
        session.store_id,
        chatHistory
    );

    return {
        content: result.content,
        model: result.model,
        latencyMs: result.latencyMs,
        apiCalled: result.apiCalled,
        // Thêm product IDs vào metadata để frontend render cards
        productIds: result.productIds || [],
        products: result.products || []
    };
}
```

4. **Cập nhật metadata khi save message:**

```diff
      await this.chatRepo.addMessage(sessionId, 'assistant', response.content, intentResult.intent, {
          model: response.model || null,
          latencyMs: response.latencyMs || null,
          intent: intentResult.intent,
          apiCalled: response.apiCalled || null,
-         error: response.error || null
+         error: response.error || null,
+         productIds: response.productIds || null,
+         products: response.products || null
      });
```

#### [MODIFY] `services/chatbot/src/index.js`

Cập nhật dependency graph:

```diff
+ const EmbeddingClient = require('./services/embedding.client');
+ const DataIngestionService = require('./services/data-ingestion.service');
+ const RAGService = require('./services/rag.service');
+ const KnowledgeRepository = require('./repositories/knowledge.repository');
+ const cron = require('node-cron');

  // ...

  const chatRepo = new ChatRepository(pool);
+ const knowledgeRepo = new KnowledgeRepository(pool);
+
+ // Embedding Client (async init)
+ const embeddingClient = new EmbeddingClient('keepitreal/vietnamese-sbert');
+
+ // RAG Service
+ const ragService = new RAGService(knowledgeRepo, embeddingClient, hfClient);
+
+ // Data Ingestion
+ const ingestionService = new DataIngestionService(pool, embeddingClient, apiClient);
+
- const chatService = new ChatService(chatRepo, hfClient, apiClient);
+ const chatService = new ChatService(chatRepo, hfClient, apiClient, ragService);
```

---

### Step 1.7 — WebSocket Response Update

#### [MODIFY] `services/chatbot/src/ws/chat.handler.js`

Cập nhật response format để bao gồm `productIds` cho frontend:

```diff
  const response = {
      success: true,
      data: {
          session_id,
          intent: result.intent,
          reply: result.reply,
          metadata: result.metadata,
+         productIds: result.metadata?.productIds || [],
+         products: result.metadata?.products || [],
          timestamp: new Date().toISOString()
      }
  };
```

---

### Step 1.8 — Health Check & Admin Endpoints

#### [MODIFY] `services/chatbot/src/routes/chat.routes.js`

Thêm endpoint kiểm tra trạng thái RAG:

```javascript
// GET /api/chat/rag/status — RAG system status
router.get('/rag/status', async (req, res, next) => {
    try {
        const storeId = req.user.storeId || 1;
        const stats = await chatService.getRAGStatus(storeId);
        return success(res, stats);
    } catch (err) {
        next(err);
    }
});

// POST /api/chat/rag/sync — Trigger manual sync (admin only)
router.post('/rag/sync', async (req, res, next) => {
    try {
        // TODO: Check admin role
        const result = await chatService.triggerSync();
        return success(res, result);
    } catch (err) {
        next(err);
    }
});
```

---

## PHASE 1 — FILE SUMMARY

### Files mới (NEW)

| File | Mô tả |
|------|--------|
| `services/chatbot/src/services/embedding.client.js` | Local Vietnamese SBERT via @xenova/transformers |
| `services/chatbot/src/services/data-ingestion.service.js` | Cron-based RAG data pipeline |
| `services/chatbot/src/services/rag.service.js` | RAG query orchestrator (embed → search → LLM) |
| `services/chatbot/src/repositories/knowledge.repository.js` | pgvector search operations |

### Files sửa (MODIFY)

| File | Thay đổi |
|------|----------|
| `docker-compose.yml` | Image `postgres:16-alpine` → `pgvector/pgvector:pg16` |
| `docker-compose.override.yml` | Tương tự |
| `docker-compose.supabase.yml` | Tương tự |
| `services/chatbot/src/db/init.sql` | Thêm pgvector extension + bảng `product_knowledge_base` + `processed_events` |
| `services/chatbot/package.json` | Thêm deps: `@xenova/transformers`, `pgvector`, `node-cron` |
| `services/chatbot/src/index.js` | Thêm EmbeddingClient, RAGService, DataIngestionService, Cron job |
| `services/chatbot/src/services/intent.resolver.js` | Thêm intent `RECOMMENDATION` |
| `services/chatbot/src/services/chat.service.js` | Inject RAGService, thêm `_handleRecommendation()` |
| `services/chatbot/src/services/api.client.js` | Thêm `getAllProducts()`, `getStoreInventory()`, `getStores()` |
| `services/chatbot/src/ws/chat.handler.js` | Thêm `productIds` + `products` vào WS response |
| `services/chatbot/src/routes/chat.routes.js` | Thêm `/rag/status` + `/rag/sync` endpoints |
| `supabase_init_all.sql` | Thêm `product_knowledge_base` + `processed_events` vào section Service 8 |

---

## PHASE 2: ENHANCEMENT (FUTURE PHASES)

### Step 2.1 — Event-driven Sync

**Mục tiêu:** Catalog service publish events → Chatbot subscribe → near-real-time sync.

#### Catalog Service changes

```javascript
// Trong productService.createProduct() và updateProduct():
await eventBus.publish('product.created', { productId, name, categoryId, unitPrice, vendor });
await eventBus.publish('product.updated', { productId, name, categoryId, unitPrice, vendor });
await eventBus.publish('product.price_changed', { productId, oldPrice, newPrice });
```

#### Chatbot Service subscriber

```javascript
// Trong chatbot/src/index.js:
await eventBus.subscribe(SERVICE_NAME, 'product.*', async (message) => {
    // Re-sync single product across all stores
    await ingestionService.syncProduct(message.data.productId);
});

await eventBus.subscribe(SERVICE_NAME, 'inventory.updated', async (message) => {
    // Update is_in_stock + quantity_on_shelf
    await ingestionService.syncInventoryForProduct(
        message.data.storeId,
        message.data.productId
    );
});
```

**Timeline ước tính:** 1-2 ngày sau khi Phase 1 ổn định.

---

### Step 2.2 — Personalization

**Mục tiêu:** Gợi ý dựa trên profile khách hàng (VIP, retail, wholesale).

#### Dữ liệu cần:
- `customer.customer_type` (từ Auth service)
- `customer.total_spent` (từ Auth service)
- `sales_settings.discount_vip/wholesale/retail` (từ Settings service)

#### Logic:
```
IF customer_type = 'VIP' AND total_spent > 5M:
    → Ưu tiên gợi ý sản phẩm premium/giá cao
    → Thêm context: "Bạn được giảm {discount_vip}% cho đơn hàng"
ELSE IF customer_type = 'wholesale':
    → Ưu tiên sản phẩm số lượng lớn/giá sỉ
ELSE:
    → Gợi ý deal/khuyến mãi
```

**Timeline ước tính:** 2-3 ngày.

---

### Step 2.3 — Co-purchase Recommendation

**Mục tiêu:** "Khách mua sản phẩm A thường mua kèm B và C."

#### Dữ liệu cần:
- `sale_order_detail` (từ Order service) — phân tích product affinity

#### Logic:
```sql
-- Tìm sản phẩm thường mua cùng product X
SELECT sod2.product_name, COUNT(*) AS co_purchase_count
FROM sale_order_detail sod1
JOIN sale_order_detail sod2 ON sod1.order_id = sod2.order_id
    AND sod1.product_name != sod2.product_name
JOIN sale_order so ON sod1.order_id = so.id
WHERE sod1.product_name = 'Bia Tiger'
    AND so.store_id = $1
    AND so.status IN ('completed', 'delivered')
GROUP BY sod2.product_name
ORDER BY co_purchase_count DESC
LIMIT 3;
```

→ Kết quả merge vào RAG context trước khi gửi LLM.

**Timeline ước tính:** 3-5 ngày.

---

## VERIFICATION PLAN

### Phase 1 Verification Checklist

| # | Test | Cách verify |
|---|------|-------------|
| 1 | pgvector extension hoạt động | `SELECT extversion FROM pg_extension WHERE extname = 'vector'` |
| 2 | Bảng `product_knowledge_base` tạo đúng | `\d product_knowledge_base` trong psql |
| 3 | Embedding model load thành công | Log: `"Embedding model loaded"` khi service start |
| 4 | Cron sync chạy đúng | Log: `"RAG Data Ingestion: Sync completed"` mỗi 15 phút |
| 5 | Data được upsert đúng | `SELECT COUNT(*), store_id FROM product_knowledge_base GROUP BY store_id` |
| 6 | Vector search trả kết quả | `GET /api/chat/rag/status` → kiểm tra `total_products > 0` |
| 7 | RAG recommendation end-to-end | Gửi "Gợi ý mình vài loại bia" → bot trả lời + productIds |
| 8 | Metadata filtering đúng store | Ensure kết quả chỉ chứa sản phẩm ĐÚng store_id |
| 9 | is_in_stock filtering | Ensure không gợi ý sản phẩm hết hàng |
| 10 | WebSocket response có productIds | Socket.IO client nhận `productIds` + `products` array |

### Test Commands

```bash
# 1. Rebuild & start services
docker compose build chatbot
docker compose up -d

# 2. Verify pgvector
docker exec -it <postgres> psql -U posmart -d chatbot_db -c "SELECT extversion FROM pg_extension WHERE extname = 'vector';"

# 3. Check knowledge base data
docker exec -it <postgres> psql -U posmart -d chatbot_db -c "SELECT product_id, store_id, is_in_stock, LEFT(content, 80) FROM product_knowledge_base LIMIT 10;"

# 4. Test RAG via REST
curl -X POST http://localhost:3008/api/chat/message \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"session_id": 1, "message": "Gợi ý mình vài loại bia ngon"}'

# 5. Check RAG status
curl http://localhost:3008/api/chat/rag/status \
  -H "Authorization: Bearer <token>"
```

---

## THỨ TỰ TRIỂN KHAI ĐỀ XUẤT

```
Ngày 1:  Step 1.1 (Docker) + Step 1.2 (DB Schema)
         → Verify: pgvector works, table created

Ngày 2:  Step 1.3 (Embedding Client) + Step 1.4 (Data Ingestion)
         → Verify: model loads, cron syncs data

Ngày 3:  Step 1.5 (RAG Query) + Step 1.6 (ChatService integration)
         → Verify: end-to-end recommendation works

Ngày 4:  Step 1.7 (WebSocket) + Step 1.8 (Admin endpoints)
         → Verify: frontend receives productIds

Ngày 5:  Testing & Bug fixes
         → Full verification checklist ✓
```
