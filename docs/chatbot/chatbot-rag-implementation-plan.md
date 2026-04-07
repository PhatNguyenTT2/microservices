# KẾ HOẠCH TRIỂN KHAI: ADVANCED RAG CHATBOT

**Dự án:** POSMART — Hệ thống Quản lý Chuỗi Siêu thị Mini
**Module:** Service 8 (AI Chatbot — Port 3008)
**Cập nhật:** 2026-04-07 (v2 — Advanced RAG với Hybrid Search + Event-Driven)
**Kiến trúc:** Hybrid Search (Vector + Keyword) + RRF + Personalization

---

## QUYẾT ĐỊNH KỸ THUẬT ĐÃ CHỐT

| # | Quyết định | Lựa chọn |
|---|-----------|----------|
| 1 | Embedding model | `keepitreal/vietnamese-sbert` (768d) via `@xenova/transformers` local |
| 2 | Đồng bộ dữ liệu | **Event-Driven (RabbitMQ)** + Cron 30 phút fallback |
| 3 | Retrieval | **Hybrid Search**: pgvector (Semantic) + tsvector (Keyword) + RRF |
| 4 | LLM | Phi-3-mini-4k-instruct via HuggingFace Inference API |
| 5 | pgvector | Supabase đã hỗ trợ sẵn pgvector — không cần đổi Docker image |
| 6 | Catalog events | Thêm event publishing ngay Phase 1 (qua repository pattern) |

---

## TỔNG QUAN CÁC PHASE

```
Phase 1: Nền tảng Dữ liệu & Ingestion Pipeline
  ├── 1.1: Database Schema (pgvector + tsvector + co_purchase)
  ├── 1.2: Embedding Client (@xenova/transformers)
  ├── 1.3: Data Ingestion (Event-Driven + Cron fallback)
  ├── 1.4: Cross-Service: Catalog + Inventory publish events
  └── 1.5: API Client mở rộng

Phase 2: Advanced Retrieval (Hybrid Search + RRF)
  ├── 2.1: Knowledge Repository (Dual Search SQL)
  ├── 2.2: Query Reformulation (lịch sử hội thoại)
  └── 2.3: RAG Service (Hybrid Search → RRF → Generation)

Phase 3: Personalization & Co-purchase
  ├── 3.1: Co-purchase Repository + Order event handler
  ├── 3.2: Personalized Context Builder
  └── 3.3: Prompt template chuẩn Phi-3

Phase 4: Tích hợp & Kiểm thử
  ├── 4.1: Intent Resolver (thêm RECOMMENDATION)
  ├── 4.2: ChatService + RAG handler
  ├── 4.3: index.js bootstrap + event subscriptions
  ├── 4.4: WebSocket + REST endpoints
  └── 4.5: Verification & Testing
```

---

## PHASE 1: NỀN TẢNG DỮ LIỆU & INGESTION

### Step 1.1 — Database Schema

**[MODIFY]** `services/chatbot/src/db/init.sql` — Thêm vào cuối file:

```sql
-- ============================================================
-- RAG: pgvector + Full-text Search
-- ============================================================
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS product_knowledge_base (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    product_id BIGINT NOT NULL,
    store_id BIGINT NOT NULL,
    content TEXT NOT NULL,
    embedding VECTOR(768),
    fts_content TSVECTOR,                    -- NEW: cho Keyword Search
    category_name TEXT,
    unit_price NUMERIC DEFAULT 0,
    is_in_stock BOOLEAN DEFAULT TRUE,
    quantity_on_shelf INT DEFAULT 0,
    last_synced_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (product_id, store_id)
);

-- HNSW cho vector search
CREATE INDEX IF NOT EXISTS idx_pkb_embedding
    ON product_knowledge_base USING hnsw (embedding vector_cosine_ops);

-- GIN cho full-text search
CREATE INDEX IF NOT EXISTS idx_pkb_fts
    ON product_knowledge_base USING gin (fts_content);

-- B-Tree cho metadata filtering
CREATE INDEX IF NOT EXISTS idx_pkb_store_stock
    ON product_knowledge_base(store_id, is_in_stock) WHERE is_in_stock = TRUE;

CREATE INDEX IF NOT EXISTS idx_pkb_product_store
    ON product_knowledge_base(product_id, store_id);

-- ============================================================
-- Co-purchase Statistics
-- ============================================================
CREATE TABLE IF NOT EXISTS co_purchase_stats (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    product_id_a BIGINT NOT NULL,
    product_id_b BIGINT NOT NULL,
    store_id BIGINT NOT NULL,
    co_purchase_count INT DEFAULT 1,
    last_updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (product_id_a, product_id_b, store_id)
);

CREATE INDEX IF NOT EXISTS idx_copurchase_lookup
    ON co_purchase_stats(product_id_a, store_id) WHERE co_purchase_count >= 3;

-- ============================================================
-- Event Idempotency
-- ============================================================
CREATE TABLE IF NOT EXISTS processed_events (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    processed_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Điểm mới so với plan cũ:**
- Thêm cột `fts_content TSVECTOR` + GIN index cho Keyword Search
- Thêm bảng `co_purchase_stats` ngay từ Phase 1 (plan cũ để Phase 2)

---

### Step 1.2 — Embedding Client

**[NEW]** `services/chatbot/src/services/embedding.client.js` — Giữ nguyên thiết kế từ plan cũ.

- `initialize()` — load model `keepitreal/vietnamese-sbert` (quantized INT8)
- `embed(text)` → `number[768]`
- `embedBatch(texts[])` → sequential, tránh OOM

**[MODIFY]** `services/chatbot/package.json` — Thêm deps:

```diff
  "dependencies": {
+   "@xenova/transformers": "^2.17.0",
+   "pgvector": "^0.2.0",
+   "node-cron": "^3.0.3",
```

---

### Step 1.3 — Data Ingestion (Event-Driven + Cron)

**[NEW]** `services/chatbot/src/services/data-ingestion.service.js`

```javascript
class DataIngestionService {
    constructor(pool, embeddingClient, apiClient) { ... }

    // === Event Handlers (Primary — near real-time) ===

    async handleProductCreated(event) {
        // 1. Kiểm tra idempotency (processed_events)
        // 2. Lấy inventory cho tất cả stores
        // 3. Format content → Embed → UPSERT per store
    }

    async handleProductUpdated(event) {
        // 1. Idempotency check
        // 2. Re-format content → Re-embed → UPDATE
    }

    async handleProductDeleted(event) {
        // DELETE FROM product_knowledge_base WHERE product_id = $1
    }

    async handleInventoryUpdated(event) {
        // 1. Lấy product data từ knowledge_base
        // 2. Cập nhật is_in_stock, quantity_on_shelf
        // 3. Re-embed nếu content thay đổi đáng kể
    }

    async handleOrderCompleted(event) {
        // 1. Lấy product IDs từ event.items[]
        // 2. Tạo tất cả cặp (A,B) → UPSERT co_purchase_stats
    }

    // === Cron Fallback (mỗi 30 phút) ===

    async syncAll() {
        // Full-sync Catalog + Inventory → knowledge_base
        // Giống plan cũ nhưng interval = 30 phút (ko phải 15)
    }

    // === Helpers ===

    _buildContentText(product, category, price, qty) {
        // Template tối ưu cho cả Vector lẫn Keyword:
        // "Sản phẩm "Bia Tiger 330ml", danh mục "Đồ uống có cồn",
        //  giá 15.000đ. Từ khóa: bia tiger, tiger beer, lon 330ml."
        return content;
    }

    _buildFtsContent(content) {
        // to_tsvector('simple', content)
        // Dùng 'simple' config vì tiếng Việt không cần stemming
    }
}
```

**Điểm mới so với plan cũ:**
- Event handlers là primary, cron là fallback (plan cũ: cron only)
- Content template bổ sung "Từ khóa:" cho keyword search
- Tạo `fts_content` (tsvector) cùng lúc với embedding
- Handler cho `order.completed` → co_purchase_stats

---

### Step 1.4 — Cross-Service: Event Publishing

#### [MODIFY] `services/catalog/src/services/product.service.js`

Catalog dùng repository pattern. Thêm eventBus vào constructor + publish sau CRUD:

```diff
+ const eventBus = require('../../../../shared/event-bus');
+ const EVENT = require('../../../../shared/event-bus/eventTypes');

  class ProductService {
-     constructor(productRepository, categoryRepository, priceHistoryRepository, dbPool) {
+     constructor(productRepository, categoryRepository, priceHistoryRepository, dbPool, eventBusInstance = null) {
          // ... giữ nguyên
+         this.eventBus = eventBusInstance;
      }

      async createProduct(data) {
          // ... logic hiện tại giữ nguyên ...
          const row = await this.productRepository.create(dbData);
-         return this.getProductById(row.id);
+         const product = await this.getProductById(row.id);
+         if (this.eventBus) {
+             await this.eventBus.publish(EVENT.PRODUCT_CREATED, {
+                 productId: product.id, name: product.name,
+                 categoryId: product.categoryId, categoryName: product.categoryName,
+                 unitPrice: product.unitPrice, vendor: product.vendor
+             });
+         }
+         return product;
      }

      async updateProduct(id, data) {
          // ... logic hiện tại giữ nguyên ...
          await this.productRepository.update(id, dbData);
-         return this.getProductById(id);
+         const product = await this.getProductById(id);
+         if (this.eventBus) {
+             await this.eventBus.publish(EVENT.PRODUCT_UPDATED, {
+                 productId: product.id, name: product.name,
+                 categoryId: product.categoryId, categoryName: product.categoryName,
+                 unitPrice: product.unitPrice, vendor: product.vendor
+             });
+         }
+         return product;
      }

      async deleteProduct(id) {
+         const product = await this.getProductById(id);
          await this.productRepository.delete(id);
+         if (this.eventBus) {
+             await this.eventBus.publish(EVENT.PRODUCT_DELETED, {
+                 productId: parseInt(id), name: product.name
+             });
+         }
          return { message: 'Product deleted successfully' };
      }

      async updatePrice(id, newPrice, reason, changedByUserId) {
          // ... transaction logic giữ nguyên ...
+         if (this.eventBus) {
+             await this.eventBus.publish(EVENT.PRODUCT_PRICE_CHANGED, {
+                 productId: parseInt(id), oldPrice: Number(rawProduct.unit_price), newPrice
+             });
+         }
          return this.getProductById(id);
      }
  }
```

#### [MODIFY] `services/catalog/src/index.js`

Inject eventBus vào ProductService:

```diff
- const productService = new ProductService(productRepo, categoryRepo, priceHistoryRepo, pool);
+ const productService = new ProductService(productRepo, categoryRepo, priceHistoryRepo, pool, eventBus);
```

#### [MODIFY] `services/inventory/src/index.js`

Thêm publish `inventory.updated` trong các event handlers hiện có (sau deduct/reserve/release):

```javascript
// Sau khi deduct/reserve stock thành công:
await eventBus.publish(EVENT.INVENTORY_UPDATED, {
    storeId: message.data.storeId,
    productId: item.product_id,
    quantityOnShelf: updatedStock.quantity_on_shelf,
    isInStock: updatedStock.quantity_on_shelf > 0
});
```

---

### Step 1.5 — API Client mở rộng

**[MODIFY]** `services/chatbot/src/services/api.client.js` — Thêm methods:

```javascript
async getAllProducts() {
    return this._fetch(`${SERVICE_URLS.catalog}/api/products`);
}

async getStoreInventory(storeId) {
    return this._fetch(`${SERVICE_URLS.inventory}/api/inventory/summary?storeId=${storeId}`);
}

async getCustomerProfile(customerId) {
    const authUrl = process.env.AUTH_SERVICE_URL || 'http://auth:3001';
    return this._fetch(`${authUrl}/api/customers/${customerId}`);
}

async getStores() {
    const authUrl = process.env.AUTH_SERVICE_URL || 'http://auth:3001';
    return this._fetch(`${authUrl}/api/stores`);
}
```

---

## PHASE 2: ADVANCED RETRIEVAL (HYBRID SEARCH + RRF)

### Step 2.1 — Knowledge Repository (Dual Search)

**[NEW]** `services/chatbot/src/repositories/knowledge.repository.js`

```javascript
class KnowledgeRepository {
    constructor(pool) { this.pool = pool; }

    /** Semantic search via pgvector cosine distance */
    async searchSemantic(queryVector, storeId, limit = 10) {
        const vectorStr = `[${queryVector.join(',')}]`;
        const { rows } = await this.pool.query(`
            SELECT *, 1 - (embedding <=> $1::vector) AS score
            FROM product_knowledge_base
            WHERE store_id = $2 AND is_in_stock = TRUE
            ORDER BY embedding <=> $1::vector ASC
            LIMIT $3
        `, [vectorStr, storeId, limit]);
        return rows;
    }

    /** Keyword search via PostgreSQL tsvector */
    async searchKeyword(query, storeId, limit = 10) {
        const { rows } = await this.pool.query(`
            SELECT *, ts_rank(fts_content, plainto_tsquery('simple', $1)) AS score
            FROM product_knowledge_base
            WHERE store_id = $2
              AND is_in_stock = TRUE
              AND fts_content @@ plainto_tsquery('simple', $1)
            ORDER BY score DESC
            LIMIT $3
        `, [query, storeId, limit]);
        return rows;
    }

    async getStats(storeId) { /* ... count, oldest/latest sync ... */ }

    async upsertKnowledge(data) { /* ... INSERT ON CONFLICT DO UPDATE ... */ }

    async deleteByProductId(productId) { /* ... */ }
}
```

---

### Step 2.2 — Query Reformulation

**[NEW]** `services/chatbot/src/services/query-reformulator.js`

```javascript
class QueryReformulator {
    constructor(hfClient) { this.hfClient = hfClient; }

    async reformulate(userMessage, chatHistory) {
        // Nếu message rõ ràng (không chứa đại từ) → trả nguyên
        if (!this._needsReformulation(userMessage)) return userMessage;
        if (!chatHistory?.length) return userMessage;

        // Gọi Phi-3 rewrite câu hỏi
        const prompt = `Dựa trên lịch sử hội thoại, viết lại câu hỏi sau thành câu độc lập:
Lịch sử: ${chatHistory.map(m => `${m.role}: ${m.content}`).join('\n')}
Câu hỏi: "${userMessage}"
Câu viết lại:`;

        const result = await this.hfClient.chatCompletion([{ role: 'user', content: prompt }]);
        return result.content?.trim() || userMessage;
    }

    _needsReformulation(msg) {
        const pronouns = ['nó', 'cái đó', 'loại này', 'cái này', 'cái kia', 'món đó', 'thế', 'vậy'];
        return pronouns.some(p => msg.toLowerCase().includes(p));
    }
}
```

---

### Step 2.3 — RAG Service (Hybrid Search + RRF)

**[NEW]** `services/chatbot/src/services/rag.service.js`

```javascript
class RAGService {
    constructor(knowledgeRepo, copurchaseRepo, embeddingClient, hfClient, apiClient, reformulator) {
        // ... inject all dependencies
    }

    async recommend(userMessage, storeId, customerId, chatHistory) {
        const startTime = Date.now();

        // Step 1: Query Reformulation
        const query = await this.reformulator.reformulate(userMessage, chatHistory);

        // Step 2: Embed query
        const queryVector = await this.embeddingClient.embed(query);

        // Step 3: Hybrid Search (parallel)
        const [semanticResults, keywordResults] = await Promise.all([
            this.knowledgeRepo.searchSemantic(queryVector, storeId, 10),
            this.knowledgeRepo.searchKeyword(query, storeId, 10)
        ]);

        // Step 4: RRF Fusion
        const fused = this._reciprocalRankFusion(semanticResults, keywordResults);
        const top5 = fused.slice(0, 5);

        if (top5.length === 0) return this._fallbackNoResults(userMessage, storeId, startTime);

        // Step 5: Co-purchase Enrichment
        const coPurchaseData = await this._getCoPurchaseContext(top5, storeId);

        // Step 6: Personalization
        const customerContext = await this._getPersonalizationContext(customerId);

        // Step 7: Augmented Generation
        const response = await this._generateResponse(
            userMessage, top5, coPurchaseData, customerContext
        );

        return { content: response.content, productIds: top5.map(r => r.product_id), ... };
    }

    /** Reciprocal Rank Fusion: score(d) = SUM(1 / (k + rank)) */
    _reciprocalRankFusion(semanticList, keywordList, k = 60) {
        const scoreMap = new Map();

        semanticList.forEach((item, rank) => {
            const id = `${item.product_id}_${item.store_id}`;
            scoreMap.set(id, (scoreMap.get(id)?.score || 0) + 1 / (k + rank));
            scoreMap.get(id).item = item;
        });

        keywordList.forEach((item, rank) => {
            const id = `${item.product_id}_${item.store_id}`;
            if (!scoreMap.has(id)) scoreMap.set(id, { score: 0, item });
            scoreMap.get(id).score += 1 / (k + rank);
            scoreMap.get(id).item = item;
        });

        return [...scoreMap.values()]
            .sort((a, b) => b.score - a.score)
            .map(v => ({ ...v.item, rrf_score: v.score }));
    }
}
```

---

## PHASE 3: PERSONALIZATION & CO-PURCHASE

### Step 3.1 — Co-purchase Repository

**[NEW]** `services/chatbot/src/repositories/copurchase.repository.js`

```javascript
class CoPurchaseRepository {
    constructor(pool) { this.pool = pool; }

    async upsertPairs(productIds, storeId) {
        // Tạo tất cả cặp (A,B) từ danh sách productIds
        // UPSERT: ON CONFLICT → co_purchase_count += 1
    }

    async getRelatedProducts(productId, storeId, minCount = 3) {
        const { rows } = await this.pool.query(`
            SELECT product_id_b, co_purchase_count
            FROM co_purchase_stats
            WHERE product_id_a = $1 AND store_id = $2 AND co_purchase_count >= $3
            ORDER BY co_purchase_count DESC LIMIT 3
        `, [productId, storeId, minCount]);
        return rows;
    }
}
```

### Step 3.2 — Personalization trong RAG Service

Bổ sung vào `rag.service.js`:

```javascript
async _getPersonalizationContext(customerId) {
    if (!customerId) return { type: 'retail', prompt: '' };
    const profile = await this.apiClient.getCustomerProfile(customerId);
    if (!profile?.success) return { type: 'retail', prompt: '' };

    const customer = profile.data;
    const type = customer.customer_type || 'retail';

    const prompts = {
        vip: `Khách VIP, ưu tiên sản phẩm premium. Thông báo giảm giá VIP.`,
        wholesale: `Khách sỉ, gợi ý số lượng lớn, giá sỉ, đơn vị thùng/lốc.`,
        retail: `Khách lẻ, gợi ý giá tốt, deal hôm nay, sản phẩm phổ thông.`
    };
    return { type, prompt: prompts[type] || prompts.retail, totalSpent: customer.total_spent };
}
```

### Step 3.3 — Prompt chuẩn Phi-3

```javascript
_buildSystemPrompt(customerContext) {
    return `<|system|>
Bạn là nhân viên tư vấn siêu thị POSMART. Trả lời tiếng Việt, thân thiện.
Chỉ dùng dữ liệu sản phẩm được cung cấp. Không bịa giá hoặc sản phẩm.
${customerContext.prompt}
<|end|>`;
}
```

---

## PHASE 4: TÍCH HỢP & KIỂM THỬ

### Step 4.1 — Intent Resolver

**[MODIFY]** `services/chatbot/src/services/intent.resolver.js` — Thêm RECOMMENDATION **trước** SEARCH_PRODUCT:

```diff
  const INTENT_PATTERNS = {
+     RECOMMENDATION: {
+         keywords: ['gợi ý', 'recommend', 'đề xuất', 'tư vấn', 'nên mua',
+                    'mua gì', 'có gì ngon', 'giới thiệu', 'best seller'],
+         description: 'Gợi ý sản phẩm (RAG)'
+     },
      CHECK_STOCK: {
```

Di chuyển `gợi ý` từ SEARCH_PRODUCT sang RECOMMENDATION.

### Step 4.2 — ChatService

**[MODIFY]** `services/chatbot/src/services/chat.service.js`:
- Inject `ragService` (tham số thứ 4)
- Thêm case `RECOMMENDATION` → `_handleRecommendation(sessionId, userMessage)`
- Handler gọi `ragService.recommend()` với store_id + customer_id từ session
- Response bao gồm `productIds` cho frontend

### Step 4.3 — index.js Bootstrap

**[MODIFY]** `services/chatbot/src/index.js`:

```javascript
// Tạo dependencies
const embeddingClient = new EmbeddingClient();
const knowledgeRepo = new KnowledgeRepository(pool);
const copurchaseRepo = new CoPurchaseRepository(pool);
const reformulator = new QueryReformulator(hfClient);
const ragService = new RAGService(knowledgeRepo, copurchaseRepo, embeddingClient, hfClient, apiClient, reformulator);
const ingestionService = new DataIngestionService(pool, embeddingClient, apiClient);
const chatService = new ChatService(chatRepo, hfClient, apiClient, ragService);

// Event subscriptions
await eventBus.subscribe(SERVICE_NAME, 'product.created', msg => ingestionService.handleProductCreated(msg));
await eventBus.subscribe(SERVICE_NAME, 'product.updated', msg => ingestionService.handleProductUpdated(msg));
await eventBus.subscribe(SERVICE_NAME, 'product.deleted', msg => ingestionService.handleProductDeleted(msg));
await eventBus.subscribe(SERVICE_NAME, 'inventory.updated', msg => ingestionService.handleInventoryUpdated(msg));
await eventBus.subscribe(SERVICE_NAME, 'order.completed', msg => ingestionService.handleOrderCompleted(msg));

// Cron fallback (30 phút)
cron.schedule('*/30 * * * *', () => ingestionService.syncAll());

// Init embedding model + initial sync
embeddingClient.initialize().then(() => ingestionService.syncAll());
```

### Step 4.4 — WebSocket + REST

**[MODIFY]** `ws/chat.handler.js` — Thêm `productIds` + `products` vào response
**[MODIFY]** `routes/chat.routes.js` — Thêm `GET /rag/status`, `POST /rag/sync`

---

## CẤU TRÚC FILES SAU REFACTOR

```
chatbot/src/
├── db/init.sql                         # [MOD] +pgvector +tsvector +co_purchase
├── index.js                            # [MOD] +RAG bootstrap +events +cron
├── app.js
├── routes/
│   ├── chat.routes.js                  # [MOD] +rag endpoints
│   └── health.routes.js
├── services/
│   ├── chat.service.js                 # [MOD] +RAG handler
│   ├── rag.service.js                  # [NEW] Hybrid Search + RRF + Generation
│   ├── query-reformulator.js           # [NEW] Viết lại câu hỏi
│   ├── embedding.client.js             # [NEW] Vietnamese SBERT (ONNX)
│   ├── data-ingestion.service.js       # [NEW] Event + Cron sync
│   ├── intent.resolver.js              # [MOD] +RECOMMENDATION
│   ├── hf.client.js
│   └── api.client.js                   # [MOD] +4 methods
├── repositories/
│   ├── chat.repository.js
│   ├── knowledge.repository.js         # [NEW] Dual Search (vector + fts)
│   └── copurchase.repository.js        # [NEW] Co-purchase stats
└── ws/
    └── chat.handler.js                 # [MOD] +productIds
```

## CROSS-SERVICE CHANGES

| Service | File | Thay đổi |
|---------|------|----------|
| Catalog | `services/product.service.js` | +eventBus inject, +publish product.created/updated/deleted/price_changed |
| Catalog | `index.js` | +inject eventBus vào ProductService constructor |
| Inventory | `index.js` | +publish inventory.updated sau deduct/reserve/release |

---

## VERIFICATION PLAN

| # | Test | Verify |
|---|------|--------|
| 1 | pgvector extension | `SELECT extversion FROM pg_extension WHERE extname = 'vector'` |
| 2 | Bảng tạo đúng | `\d product_knowledge_base` — có cả embedding + fts_content |
| 3 | Embedding load | Log `"Embedding model loaded"` |
| 4 | Event sync | Tạo product mới → knowledge_base cập nhật trong <5s |
| 5 | Cron fallback | Log `"Full-sync completed"` mỗi 30 phút |
| 6 | Semantic search | Hỏi "bia ngon" → tìm thấy bia Tiger (dù content ghi "Bia Tiger 330ml") |
| 7 | Keyword search | Hỏi "tiger" → tìm chính xác qua tsvector |
| 8 | RRF fusion | Top-1 = sản phẩm xuất hiện ở cả 2 luồng |
| 9 | Query reform | "Nó giá bao nhiêu?" (sau hỏi về Bia Tiger) → rewrite đúng |
| 10 | Store isolation | Hỏi tại store 2 → không thấy sản phẩm store 1 |
| 11 | Co-purchase | Mua Bia Tiger → gợi ý Đá viên (nếu count ≥ 3) |
| 12 | Personalization | Khách VIP → response nhắc giảm giá |
| 13 | E2E WebSocket | Socket.IO response có `productIds` array |

## THỨ TỰ TRIỂN KHAI

```
Ngày 1-2:  Phase 1 (Schema + Embedding + Ingestion + Cross-service events)
Ngày 3-4:  Phase 2 (Knowledge Repo + Reformulator + RAG Service)
Ngày 5:    Phase 3 (Co-purchase + Personalization)
Ngày 6-7:  Phase 4 (Tích hợp ChatService + Testing)
```
