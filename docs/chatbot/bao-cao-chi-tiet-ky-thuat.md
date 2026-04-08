# BÁO CÁO CHI TIẾT KỸ THUẬT: ADVANCED RAG CHATBOT SERVICE

## Hệ thống POSMART — Service 8: AI Chatbot (Port 3008)

**Cập nhật:** 2026-04-08
**Kiến trúc:** Hybrid Search (pgvector + tsvector) + RRF + Personalization + Event-Driven Sync

---

## MỤC LỤC

1. [Tổng quan triển khai theo Plan](#1-tổng-quan-triển-khai-theo-plan)
2. [Phase 1: Nền tảng Dữ liệu & Data Ingestion](#2-phase-1-nền-tảng-dữ-liệu--data-ingestion)
3. [Phase 2: Advanced Retrieval Pipeline](#3-phase-2-advanced-retrieval-pipeline)
4. [Phase 3: Personalization & Co-purchase](#4-phase-3-personalization--co-purchase)
5. [Phase 4: Tích hợp hệ thống](#5-phase-4-tích-hợp-hệ-thống)
6. [Giải thích chi tiết từng file](#6-giải-thích-chi-tiết-từng-file)
7. [Cross-Service Integration & Pattern Compliance](#7-cross-service-integration--pattern-compliance)
8. [Dependency Graph & File Map](#8-dependency-graph--file-map)

---

## 1. TỔNG QUAN TRIỂN KHAI THEO PLAN

### 1.1. Mapping Plan → Code

| Phase | Step | File tạo/sửa | Trạng thái |
|-------|------|--------------|:---:|
| **Phase 1** | 1.1 Database Schema | `src/db/init.sql` | ✅ |
| | 1.2 Embedding Client | `src/services/embedding.client.js` | ✅ |
| | 1.3 Data Ingestion | `src/services/data-ingestion.service.js` | ✅ |
| | 1.4 Catalog Event Publishing | `catalog/src/services/product.service.js` (cross-service) | ✅ |
| | 1.5 API Client mở rộng | `src/services/api.client.js` | ✅ |
| **Phase 2** | 2.1 Knowledge Repository | `src/repositories/knowledge.repository.js` | ✅ |
| | 2.2 Query Reformulation | `src/services/query-reformulator.js` | ✅ |
| | 2.3 RAG Service | `src/services/rag.service.js` | ✅ |
| **Phase 3** | 3.1 Co-purchase Repository | `src/repositories/copurchase.repository.js` | ✅ |
| | 3.2 Personalized Context | Tích hợp trong `rag.service.js` (`_getPersonalizationContext`) | ✅ |
| | 3.3 Prompt Template | Tích hợp trong `rag.service.js` (`_generateResponse`) | ✅ |
| **Phase 4** | 4.1 Intent Resolver | `src/services/intent.resolver.js` (thêm RECOMMENDATION) | ✅ |
| | 4.2 ChatService + RAG | `src/services/chat.service.js` | ✅ |
| | 4.3 Bootstrap | `src/index.js` | ✅ |
| | 4.4 REST + WebSocket | `src/routes/chat.routes.js` + `src/ws/chat.handler.js` | ✅ |

### 1.2. Luồng kiến trúc tổng quan

```
                    ┌─────────────────────────────────────────────────────┐
                    │                  index.js (Bootstrap)                │
                    │  ┌──────────┬──────────┬──────────┬───────────────┐ │
                    │  │ Database │ EventBus │ HFClient │ EmbeddingClient│ │
                    │  └──────────┴──────────┴──────────┴───────────────┘ │
                    │         │          │                    │            │
                    │    ┌────┴────┐  ┌──┴──────────────┐   │            │
                    │    │  Repos  │  │ Event Handlers   │   │            │
                    │    │ ┌──────┐│  │ product.*        │   │            │
                    │    │ │Chat  ││  │ inventory.updated │   │            │
                    │    │ │Know. ││  │ order.completed  │   │            │
                    │    │ │CoPur.││  └────────┬─────────┘   │            │
                    │    │ └──────┘│           │              │            │
                    │    └────┬────┘  DataIngestionService ←──┘            │
                    │         │                                            │
                    │    ┌────┴──────────────────────────────┐            │
                    │    │         ChatService                │            │
                    │    │  Intent → Handler → Response       │            │
                    │    │  RECOMMENDATION → RAGService       │            │
                    │    │  CHECK_STOCK → ApiClient → AI      │            │
                    │    │  FREE_CHAT → HFClient              │            │
                    │    └────┬──────────────────┬────────────┘            │
                    │         │                  │                         │
                    │    chat.routes.js    ws/chat.handler.js              │
                    │    (REST API)        (Socket.IO)                     │
                    └─────────────────────────────────────────────────────┘
```

---

## 2. PHASE 1: NỀN TẢNG DỮ LIỆU & DATA INGESTION

### 2.1. Database Schema (`init.sql`)

**File:** `src/db/init.sql` — 107 dòng

File này định nghĩa toàn bộ schema cho `chatbot_db`. Được thực thi tự động khi service khởi động thông qua `initDatabase(pool)` trong `index.js`.

**Phần 1 — Chat Tables (dòng 1-29):**

```sql
-- chat_session: Phiên chat với user
-- Có CHECK constraint cho user_type IN ('customer', 'employee')
-- store_id nullable — cho phép chat không cần context chi nhánh

-- chat_message: Tin nhắn trong phiên
-- role IN ('user', 'assistant', 'system') — tuân theo chuẩn OpenAI
-- intent: lưu loại ý định đã phân loại (RECOMMENDATION, CHECK_STOCK...)
-- metadata: JSONB chứa model name, latencyMs, productIds — cho monitoring

-- Index: idx_chat_session_active — partial index WHERE is_active = TRUE
--   → Tối ưu khi hầu hết sessions sẽ inactive (đã kết thúc)
```

**Phần 2 — RAG Knowledge Base (dòng 31-73):**

```sql
-- product_knowledge_base: Bảng core RAG
-- VECTOR(768): khớp với output dimension của Vietnamese SBERT
-- fts_content TSVECTOR: song song vector search, cho keyword matching
-- UNIQUE(product_id, store_id): 1 record per product per store (upsert)

-- 4 indexes:
-- 1. HNSW(embedding vector_cosine_ops) — vector similarity O(log n)
-- 2. GIN(fts_content) — inverted index cho full-text search
-- 3. B-Tree partial(store_id, is_in_stock) WHERE is_in_stock = TRUE
--      → Tối ưu: chỉ index sản phẩm còn hàng (skip hết hàng)
-- 4. B-Tree(product_id, store_id) — hỗ trợ ON CONFLICT UPSERT
```

**Tại sao dùng HNSW thay vì IVFFlat?**
- HNSW có recall cao hơn (97-99%) vs IVFFlat (90-95%).
- HNSW không cần rebuild index khi thêm data mới — quan trọng vì data sync liên tục qua events.
- Dataset dự kiến < 1M records → HNSW performant hơn.

**Phần 3 — Co-purchase Stats (dòng 75-91):**

```sql
-- co_purchase_stats: Thống kê mua kèm
-- UNIQUE(product_id_a, product_id_b, store_id) — upsert thông qua ON CONFLICT
-- Partial index WHERE co_purchase_count >= 3 — chỉ index cặp đủ ngưỡng
--   → Tối ưu: query gợi ý chỉ cần cặp có frequency ≥ 3
```

**Phần 4 — Processed Events (dòng 93-106):**

```sql
-- processed_events: Idempotency cho event-driven sync
-- Pattern thống nhất với inventory, order, payment services:
-- UNIQUE(event_id, service_name) — cho phép nhiều service xử lý cùng event
-- service_name DEFAULT 'chatbot-service' — auto-fill
```

### 2.2. Embedding Client (`embedding.client.js`)

**File:** `src/services/embedding.client.js` — 81 dòng

Class `EmbeddingClient` wraps `@xenova/transformers` pipeline để chạy Vietnamese SBERT local.

**Luồng hoạt động:**

```
initialize()
  → pipeline('feature-extraction', 'keepitreal/vietnamese-sbert', { quantized: true })
  → Download model lần đầu (~150MB INT8) → cache ở ~/.cache/
  → Set isReady = true

embed(text)
  → Guard: isReady?
  → extractor(text, { pooling: 'mean', normalize: true })
  → Array.from(output.data) → number[768]
```

**Chi tiết kỹ thuật:**

| Tham số | Giá trị | Lý do |
|---------|---------|-------|
| `quantized: true` | INT8 quantization | Giảm 4x kích thước model (600MB → 150MB), giữ 99% accuracy |
| `pooling: 'mean'` | Mean Pooling | Lấy trung bình tất cả token embeddings → 1 sentence vector |
| `normalize: true` | L2 Normalization | Đưa vector về unit sphere → cosine distance = dot product |

**`embedBatch(texts)`** — embed nhiều text tuần tự (sequential, không parallel) để tránh OOM trên CPU. Dùng trong `syncAll()` khi full-sync.

### 2.3. Data Ingestion Service (`data-ingestion.service.js`)

**File:** `src/services/data-ingestion.service.js` — 330 dòng

Class lớn nhất trong service (330 dòng), chịu trách nhiệm **đồng bộ dữ liệu từ các service khác vào knowledge base**.

**Dependency Injection:**
```javascript
constructor(pool, embeddingClient, apiClient)
// pool: PostgreSQL connection pool
// embeddingClient: Vietnamese SBERT (local)
// apiClient: HTTP client cho Catalog/Inventory/Auth
```

#### 2.3.1. Event Handlers (Primary — gần real-time)

**`handleProductCreated(message)` (dòng 19-37):**
```
1. Kiểm tra idempotency: _isProcessed(message.id)
2. Lấy danh sách stores: _getStoreIds()
3. Với mỗi store:
   a. Lấy inventory: _fetchInventoryForProduct(storeId, productId)
   b. Upsert knowledge: _upsertKnowledge({...})
      → Tạo content text → Embed 768d → INSERT...ON CONFLICT
4. Đánh dấu đã xử lý: _markProcessed(message.id, message.type)
```

**`handleProductUpdated(message)` (dòng 39-57):**
- Logic giống `handleProductCreated` — vì đều UPSERT.
- Product.price_changed event cũng route vào đây (trong index.js).

**`handleProductDeleted(message)` (dòng 59-70):**
```sql
DELETE FROM product_knowledge_base WHERE product_id = $1
-- Xóa TẤT CẢ records (mọi store) — vì product đã bị xóa khỏi catalog
```

**`handleInventoryUpdated(message)` (dòng 72-111):**

Đây là handler phức tạp nhất, có **tối ưu re-embedding**:

```javascript
// 1. Lấy record hiện tại từ knowledge base
const existing = rows[0];

// 2. Kiểm tra is_in_stock có thay đổi không
const contentChanged = existing.is_in_stock !== newIsInStock;

if (contentChanged) {
    // Stock status thay đổi (hết hàng ↔ còn hàng)
    // → Content text thay đổi → PHẢI re-embed
    await this._upsertKnowledge({...});
} else {
    // Chỉ qty thay đổi → Light UPDATE (không gọi SBERT)
    await this.pool.query('UPDATE ... SET quantity_on_shelf = $1 ...');
}
```

**Tại sao tối ưu này quan trọng?**
- Embed 1 text trên CPU ≈ 50-200ms.
- Nếu mỗi event đều re-embed → 100 events/phút = 10-20 giây CPU blocked.
- Light update chỉ tốn 1 SQL query (< 1ms).

**`handleOrderCompleted(message)` (dòng 113-136):**
```javascript
// 1. Skip nếu đơn hàng < 2 sản phẩm (không tạo được cặp)
if (!items?.length || items.length < 2) return;

// 2. Tạo tất cả pairs (sorted: a < b để tránh duplicate)
const [a, b] = [productIds[i], productIds[j]].sort((x, y) => x - y);

// 3. UPSERT: tăng count nếu cặp đã tồn tại
INSERT ... ON CONFLICT DO UPDATE SET co_purchase_count = co_purchase_count + 1
```

#### 2.3.2. Cron Fallback (`syncAll()`, dòng 140-196)

Full-sync theo cấu trúc:
```
1. _getStoreIds() → [1, 2, 3...]
2. apiClient.getAllProducts() → { data: { products: [...] } }
3. Với mỗi store:
   a. apiClient.getStoreInventory(storeId) → [{ productId, quantityOnShelf }]
   b. _buildInventoryMap(result) → Map<productId, { totalOnShelf, isInStock }>
   c. Với mỗi product:
      - Skip nếu product.isActive === false
      - Merge product info + inventory → _upsertKnowledge()
4. Return { synced, skipped, durationMs }
```

#### 2.3.3. Content Template (`_buildContentText`, dòng 222-237)

```javascript
// Output:
'Sản phẩm "Coca Cola", danh mục "Nước giải khát", giá 12.000 VND, ' +
'nhà cung cấp "Coca-Cola Vietnam", hiện còn 48 sản phẩm trên kệ. ' +
'Từ khóa: coca, cola, coca-cola, nuoc giai khat.'
```

**`_extractKeywords(name, vendor)` (dòng 239-249):**
```javascript
// Tạo keywords từ tên sản phẩm + vendor
// 1. Tách tokens gốc: "Bia Tiger" → ["bia", "tiger"]
// 2. Tạo bản không dấu: "bía tígẹr" → ["bia", "tiger"] (NFD + strip diacritics)
// 3. Thêm vendor tokens
// → Set() loại bỏ trùng → join bằng ", "
```

#### 2.3.4. Idempotency Pattern (dòng 307-326)

```javascript
async _isProcessed(eventId) {
    // Pattern: INSERT + catch duplicate (23505)
    // KHÔNG dùng SELECT rồi INSERT (race condition giữa 2 instances)
    try {
        await pool.query('INSERT INTO processed_events (event_id, event_type, service_name) VALUES ($1, $2, $3)',
            [eventId, 'check', SERVICE_NAME]);
        return false; // INSERT thành công → chưa xử lý
    } catch (err) {
        if (err.code === '23505') return true; // Duplicate → đã xử lý
        throw err; // Lỗi khác → throw
    }
}

async _markProcessed(eventId, eventType) {
    // Sau khi xử lý xong, UPDATE event_type từ 'check' → actual type
    await pool.query('UPDATE processed_events SET event_type = $1 WHERE event_id = $2 AND service_name = $3', ...);
}
```

### 2.4. API Client (`api.client.js`)

**File:** `src/services/api.client.js` — 105 dòng

HTTP client nội bộ cho cross-service calls. **Tự động tạo JWT** khi không có token (service-to-service auth):

```javascript
constructor(token = null) {
    this.token = token || generateToken({
        id: 0,
        username: 'chatbot-service',
        role: 'Admin',
        permissions: ['products.read', 'inventory.read', 'orders.read', 'customers.read']
    }, '24h');
}
```

**`_fetch(url)` — Base method:**
```javascript
// 1. Thêm Authorization header: Bearer ${token}
// 2. Gọi fetch() → parse JSON
// 3. Log: { url, status, latencyMs }
// 4. Return: { success: bool, data: response.data, latencyMs }
//    Lưu ý: data = response.data (unwrap 1 lớp) — do các API trả { success, data: {...} }
```

**Response format notes:**
| Service | Endpoint | Response shape sau `_fetch` |
|---------|----------|---------------------------|
| Catalog | GET /api/products | `{ success, data: { products: [...] } }` |
| Inventory | GET /api/inventory/summary | `{ success, data: [...] }` (direct array) |
| Auth | GET /api/stores | `{ success, data: { stores: [...] } }` |
| Auth | GET /api/customers/:id | `{ success, data: { customerType, totalSpent } }` |

---

## 3. PHASE 2: ADVANCED RETRIEVAL PIPELINE

### 3.1. Knowledge Repository (`knowledge.repository.js`)

**File:** `src/repositories/knowledge.repository.js` — 124 dòng

Repository pattern cho **dual search** trên PostgreSQL.

**`searchSemantic(queryVector, storeId, limit)` (dòng 19-36):**

```sql
SELECT product_id, store_id, content, category_name,
       unit_price, is_in_stock, quantity_on_shelf,
       1 - (embedding <=> $1::vector) AS score        -- cosine similarity
FROM product_knowledge_base
WHERE store_id = $2 AND is_in_stock = TRUE            -- metadata filter
ORDER BY embedding <=> $1::vector ASC                  -- nearest-first
LIMIT $3
```

**Giải thích `<=>` operator:**
- `<=>` = cosine distance (0 = identical, 2 = opposite)
- `1 - distance` = cosine similarity (1 = identical, -1 = opposite)
- ORDER BY ASC vì distance nhỏ = giống nhất

**`searchKeyword(query, storeId, limit)` (dòng 46-64):**

```sql
SELECT ...,
       ts_rank(fts_content, plainto_tsquery('simple', $1)) AS score
FROM product_knowledge_base
WHERE store_id = $2
  AND is_in_stock = TRUE
  AND fts_content @@ plainto_tsquery('simple', $1)     -- full-text match
ORDER BY score DESC
LIMIT $3
```

**Tại sao dùng `'simple'` config thay vì `'vietnamese'`?**
- PostgreSQL chưa có built-in Vietnamese text search config.
- `'simple'` không stemming → khớp chính xác token → phù hợp cho tiếng Việt không dấu.
- Dùng `plainto_tsquery` (không phải `to_tsquery`) để avoid syntax errors từ user input.

**`getStats(storeId)` (dòng 104-120):**

Endpoint monitoring — trả về:
```json
{
    "total_entries": 150,
    "in_stock_count": 120,
    "out_of_stock_count": 30,
    "oldest_sync": "2026-04-01T...",
    "latest_sync": "2026-04-08T..."
}
```

### 3.2. Query Reformulator (`query-reformulator.js`)

**File:** `src/services/query-reformulator.js` — 76 dòng

Xử lý **câu hỏi mơ hồ** trong hội thoại multi-turn.

**Danh sách từ kích hoạt (dòng 8-11):**
```javascript
const VIETNAMESE_PRONOUNS = [
    'nó', 'cái đó', 'cái này', 'cái kia', 'loại này', 'loại đó',
    'món đó', 'món này', 'thế', 'vậy', 'sản phẩm đó', 'hàng đó'
];
```

**Luồng `reformulate(userMessage, chatHistory)`:**
```
1. _needsReformulation(msg) — Kiểm tra msg chứa pronoun?
   → false: return msg gốc (tiết kiệm 1 LLM call)
   → true: tiếp tục

2. Nếu chatHistory rỗng → return msg gốc

3. Build prompt cho Phi-3:
   - Lấy 4 messages gần nhất (Khách: ... / Bot: ...)
   - Prompt: "Dựa trên lịch sử, viết lại câu hoàn chỉnh"
   - temperature=0.3 (low creativity), maxTokens=100

4. Validate kết quả:
   - length > 3 (không quá ngắn)
   - length < 200 (không quá dài — LLM đôi khi giải thích thêm)
   - Nếu invalid → return msg gốc

5. Catch all errors → return msg gốc (graceful degradation)
```

**Ví dụ:**
```
History: [
  Khách: "Bia Tiger giá bao nhiêu?",
  Bot: "Bia Tiger 330ml giá 15.000đ/lon"
]
User: "Nó còn hàng không?"
→ Phi-3 rewrite: "Bia Tiger 330ml còn hàng không?"
```

### 3.3. RAG Service (`rag.service.js`)

**File:** `src/services/rag.service.js` — 291 dòng

**Core pipeline** của toàn bộ hệ thống. Kết nối tất cả components.

**Constructor — Dependency Injection:**
```javascript
constructor({ knowledgeRepo, copurchaseRepo, embeddingClient, hfClient, apiClient, reformulator })
// 6 dependencies — tất cả inject từ index.js
```

#### `recommend()` — Main Pipeline (dòng 31-123)

7 bước tuần tự, mỗi bước đo `latencyMs`:

```
Step 1: reformulator.reformulate(msg, history)
   → output: standalone query string

Step 2: embeddingClient.embed(query)
   → output: number[768]

Step 3: Promise.all([
           knowledgeRepo.searchSemantic(vector, storeId, 10),
           knowledgeRepo.searchKeyword(query, storeId, 10)
         ])
   → output: semanticResults[], keywordResults[]
   → Chạy SONG SONG → tiết kiệm ~50% latency

Step 4: _reciprocalRankFusion(semantic, keyword)
   → output: merged + sorted by RRF score → top5

Step 5: _getCoPurchaseContext(top5, storeId)
   → output: [{ productId, productName, relatedProducts }]

Step 6: _getPersonalizationContext(customerId)
   → output: { type: 'vip'|'wholesale'|'retail', prompt: '...' }

Step 7: _generateResponse(originalMsg, query, top5, coPurchase, customerCtx)
   → output: { content: "Vietnamese natural language response" }
```

#### `_reciprocalRankFusion()` (dòng 129-151)

```javascript
// RRF: score(d) = SUM(1 / (k + rank + 1))   với k = 60
// rank+1 vì rank bắt đầu từ 0

// Ví dụ: Product #42 xuất hiện ở cả 2 luồng
// Semantic: rank 0 → score += 1/(60+1) = 0.0164
// Keyword:  rank 2 → score += 1/(60+3) = 0.0159
// → RRF = 0.0323

// Product #55 chỉ xuất hiện ở semantic
// Semantic: rank 1 → score = 1/(60+2) = 0.0161
// → RRF = 0.0161

// Kết quả: #42 (0.0323) > #55 (0.0161) — #42 được ưu tiên
```

**Key insight:** Sản phẩm xuất hiện ở CẢ semantic + keyword luôn được rank cao hơn sản phẩm chỉ xuất hiện ở 1 luồng. `k=60` là giá trị chuẩn từ paper gốc.

#### `_generateResponse()` (dòng 215-257)

```javascript
// System prompt structure:
// 1. Persona: "Bạn là nhân viên tư vấn siêu thị POSMART"
// 2. Rules: "CHỈ sử dụng dữ liệu được cung cấp. KHÔNG bịa thêm"
// 3. Customer context: "Khách VIP — ưu tiên premium..."
// 4. Product data: "1. Bia Tiger — Đồ uống, 15.000đ, còn 24"
// 5. Co-purchase: "Khách mua Tiger thường mua kèm: Đá viên"

// User message: message gốc (không phải reformulated)
// → Vì LLM cần hiểu ngữ cảnh tự nhiên, data đã được RAG filter

// temperature=0.6 (balanced: creative enough but factual)
// max_tokens=400 (đủ cho response ngắn gọn)
```

**Fallback khi LLM fail:** `_buildFallbackResponse()` sinh response text thuần từ data, không cần AI.

---

## 4. PHASE 3: PERSONALIZATION & CO-PURCHASE

### 4.1. Co-purchase Repository (`copurchase.repository.js`)

**File:** `src/repositories/copurchase.repository.js` — 79 dòng

**`upsertPairs(productIds, storeId)` (dòng 19-38):**

```javascript
// 1. Deduplicate + sort: [...new Set(productIds)].sort()
// 2. Nested loop: O(n²) tạo tất cả cặp
// 3. UPSERT: ON CONFLICT → count += 1

// Ví dụ: items = [42, 15, 37]
// sorted = [15, 37, 42]
//   Pair 1: (15, 37) — INSERT or count++
//   Pair 2: (15, 42) — INSERT or count++
//   Pair 3: (37, 42) — INSERT or count++
```

**`getRelatedProducts(productId, storeId, minCount)` (dòng 47-61):**

```sql
-- BIDIRECTIONAL lookup (UNION ALL):
-- Vì pairs sorted (A < B), product có thể ở cả 2 vị trí

SELECT product_id_b, co_purchase_count
FROM co_purchase_stats
WHERE product_id_a = $1 AND store_id = $2 AND co_purchase_count >= $3

UNION ALL

SELECT product_id_a, co_purchase_count
FROM co_purchase_stats
WHERE product_id_b = $1 AND store_id = $2 AND co_purchase_count >= $3

ORDER BY co_purchase_count DESC
LIMIT 3
```

### 4.2. Personalization (`_getPersonalizationContext` trong `rag.service.js`)

```javascript
// 1. Gọi Auth API: GET /api/customers/:customerId
// 2. Extract: customerType, totalSpent
// 3. Map → prompt modifier:

const prompts = {
    vip:       'Khách VIP — ưu tiên sản phẩm premium, thông báo giảm giá đặc biệt.',
    wholesale: 'Khách sỉ — gợi ý số lượng lớn, giá sỉ, đơn vị thùng/lốc.',
    retail:    'Khách lẻ — gợi ý sản phẩm giá tốt, deal đang có, sản phẩm phổ thông.'
};
```

**Graceful degradation:** Nếu API fail → return `{ type: 'retail', prompt: '' }` (default, không block pipeline).

---

## 5. PHASE 4: TÍCH HỢP HỆ THỐNG

### 5.1. Intent Resolver (`intent.resolver.js`)

**File:** `src/services/intent.resolver.js` — 67 dòng

Pure function (stateless, không dependency) — phân loại ý định bằng keyword matching.

```javascript
// 7 intents theo thứ tự ưu tiên (first match):
CHECK_STOCK → CHECK_PRICE → ORDER_STATUS → RECOMMENDATION → SEARCH_PRODUCT → HELP → FREE_CHAT

// Export: { resolveIntent, getAllIntents, INTENT_PATTERNS }
// resolveIntent returns: { intent, confidence, matchedKeyword, description }
// confidence luôn = 'keyword_match' hoặc 'default' (cho FREE_CHAT)
```

**Tại sao keyword-based thay vì ML classifier?**
- Intent domain nhỏ (7 intents) → keyword đủ accurate.
- Zero latency (< 1ms) vs ML classifier (50-100ms).
- Không cần training data.
- Dễ extend: thêm keyword vào array.

### 5.2. Chat Service (`chat.service.js`)

**File:** `src/services/chat.service.js` — 333 dòng

**Orchestrator chính** — nhận message, phân loại intent, dispatch handler, lưu lịch sử.

**`sendMessage(sessionId, userMessage)` (dòng 43-103):**

```
1. Validate: message không rỗng, session tồn tại và active
2. resolveIntent(userMessage) → { intent, matchedKeyword }
3. chatRepo.addMessage(sessionId, 'user', msg, intent) — lưu message user
4. Switch intent → handler tương ứng
5. chatRepo.addMessage(sessionId, 'assistant', response, intent, metadata)
6. Return: { intent, reply, products, metadata }
```

**Handler routing:**

| Intent | Handler | Cơ chế |
|--------|---------|--------|
| RECOMMENDATION | `_handleRecommendation(session, msg)` | RAGService.recommend() |
| SEARCH_PRODUCT | `_handleSearchProduct(session, msg)` | RAGService.recommend() nếu có, fallback Catalog ILIKE |
| CHECK_STOCK | `_handleCheckStock(sessionId, msg)` | ApiClient → Catalog search → Inventory summary → AI format |
| CHECK_PRICE | `_handleCheckPrice(sessionId, msg)` | ApiClient → Catalog search → AI format |
| ORDER_STATUS | `_handleOrderStatus(sessionId, msg)` | ApiClient → Order by ID → AI format |
| HELP | `_handleHelp()` | Static text (không gọi AI) |
| FREE_CHAT | `_handleFreeChat(sessionId, msg)` | HFClient trực tiếp (no data) |

**`_enrichWithAI(sessionId, userMessage, dataContext)` (dòng 272-281):**

Pattern chung cho DATA handlers (CHECK_STOCK, CHECK_PRICE, ORDER_STATUS):

```javascript
// 1. Lấy 5 messages gần nhất từ DB (context cho conversation)
// 2. Append: "[DATA] Sản phẩm X: On-shelf: 12..." + instruction
// 3. Gửi hfClient.chatCompletion() → Phi-3 format thành ngôn ngữ tự nhiên
// 4. Return response + apiCalled info
```

### 5.3. Bootstrap (`index.js`)

**File:** `src/index.js` — 191 dòng

**12 bước khởi động tuần tự:**

```
 1. createPool() → PostgreSQL connection
 2. initDatabase() → run init.sql
 3. eventBus.connect() → RabbitMQ
 4. new HFClient(token, model) — HuggingFace Inference
 5. new ApiClient() — S2S HTTP client (auto JWT)
 6. new EmbeddingClient() → .initialize() — load SBERT ONNX
 7. Build dependency graph:
    - chatRepo, knowledgeRepo, copurchaseRepo
    - dataIngestionService, reformulator
    - ragService (nếu embedding ready)
    - chatService
 8. Subscribe events: product.*, inventory.updated, order.completed
 9. Cron schedule: */30 * * * * → syncAll()
10. Startup sync: setTimeout 10s → syncAll()
11. Create Express app + Socket.IO
12. server.listen(PORT)
```

**Graceful degradation (dòng 76-89):**
```javascript
if (embeddingClient.isReady) {
    ragService = new RAGService({...});
} else {
    logger.warn('RAG Service DISABLED — embedding model not loaded');
    // chatService sẽ nhận ragService = null → fallback HTTP
}
```

### 5.4. REST API (`chat.routes.js`)

**File:** `src/routes/chat.routes.js` — 71 dòng

5 endpoints, tất cả yêu cầu `verifyToken`:

| Endpoint | Handler |
|----------|---------|
| `POST /sessions` | Tạo session — extract userId, storeId từ JWT |
| `GET /sessions` | Danh sách sessions — by userId |
| `GET /sessions/:id` | Chi tiết session + messages |
| `POST /sessions/:id/end` | Kết thúc session |
| `POST /message` | **Main endpoint** — `{ session_id, message }` |

**Lưu ý:** `POST /message` app-level (không phải nested trong `/sessions/:id`) — vì WebSocket cũng dùng `session_id` trong body.

### 5.5. WebSocket (`ws/chat.handler.js`)

**File:** `src/ws/chat.handler.js` — 170 dòng

Socket.IO handler reuse ChatService cho business logic, thêm real-time features.

**Auth middleware (dòng 19-32):**
```javascript
// Verify JWT từ handshake:
// - socket.handshake.auth.token (preferred)
// - socket.handshake.headers.authorization (fallback)
// → Decode → attach socket.user
```

**Socket Events:**

| Event | Client → Server | Server → Client |
|-------|----------------|-----------------|
| `chat:start_session` | `{}` | `chat:session_started` + callback |
| `chat:send_message` | `{ session_id, message }` | `chat:message_received` + callback |
| `chat:end_session` | `{ session_id }` | `chat:session_ended` + callback |
| `chat:get_history` | `{ session_id }` | callback only |
| — | — | `chat:typing` (broadcast to session room) |

**Typing indicator (dòng 69-82):**
```javascript
// Trước khi xử lý: emit typing=true → các user khác trong session thấy "Bot đang gõ..."
// Sau khi xử lý: emit typing=false
// Nếu error: cũng emit typing=false (dòng 102-107)
```

### 5.6. HF Client (`hf.client.js`)

**File:** `src/services/hf.client.js` — 71 dòng

Wrapper cho `@huggingface/inference` SDK.

```javascript
// Default system prompt (dòng 4-13):
// - Persona: POSMART Assistant
// - Rules: trả lời ngắn gọn, tiếng Việt, format [DATA]
// - Fallback: nếu không có data → dùng kiến thức chung

// chatCompletion(messages, options):
// - Prepend system prompt → gửi HuggingFace API
// - Default: max_tokens=512, temperature=0.7
// - Rate limit handling: return friendly message
// - Error: return fallback message (không throw)
```

### 5.7. Chat Repository (`chat.repository.js`)

**File:** `src/repositories/chat.repository.js` — 82 dòng

CRUD thuần cho `chat_session` + `chat_message`. Không có business logic.

**`getRecentContext(sessionId, limit)` (dòng 69-78):**
```javascript
// SELECT role, content ORDER BY created_at DESC LIMIT 10
// Rồi .reverse() → trả về theo thứ tự thời gian (cũ → mới)
// Dùng cho: chatHistory context khi gọi LLM
```

### 5.8. Health Routes (`health.routes.js`)

**File:** `src/routes/health.routes.js` — 26 dòng

```
GET /health → { status: 'ok', service, timestamp }
GET /ready  → { status: 'ready', dependencies: { postgres, hf_model } }
              → 503 nếu DB không kết nối được
```

### 5.9. App (`app.js`)

**File:** `src/app.js` — 52 dòng

Express setup với:
- `helmet()` — security headers
- `cors()` — cross-origin
- Rate limiter: 20 req/min trên `/api/chat/*` (AI calls expensive)
- `/api/rag/stats` — monitoring endpoint (nếu knowledgeRepo available)

---

## 6. GIẢI THÍCH CHI TIẾT TỪNG FILE

### File Map hoàn chỉnh

```
chatbot/
├── package.json                    # Dependencies: @xenova/transformers, pgvector, node-cron, socket.io
├── README.md                       # Technical reference (Vietnamese, chuẩn pattern dự án)
└── src/
    ├── db/
    │   └── init.sql                # [107 dòng] 5 tables + 7 indexes + pgvector extension
    │                               # Phase 1.1
    │
    ├── index.js                    # [191 dòng] Bootstrap: DB → EventBus → AI Models →
    │                               #   DI Container → Event Subs → Cron → Express → Socket.IO
    │                               # Phase 4.3
    │
    ├── app.js                      # [52 dòng] Express middleware + rate limiter + RAG stats
    │                               # Phase 4.4
    │
    ├── routes/
    │   ├── chat.routes.js          # [71 dòng] 5 REST endpoints (sessions CRUD + message)
    │   │                           # Phase 4.4
    │   └── health.routes.js        # [26 dòng] /health + /ready probes
    │
    ├── services/
    │   ├── chat.service.js         # [333 dòng] ORCHESTRATOR — intent routing + 7 handlers
    │   │                           # Phase 4.2 — kết nối RAG + HTTP + LLM
    │   │
    │   ├── rag.service.js          # [291 dòng] RAG PIPELINE — 7 bước: reform → embed →
    │   │                           #   hybrid search → RRF → co-purchase → personalize → generate
    │   │                           # Phase 2.3
    │   │
    │   ├── data-ingestion.service.js # [330 dòng] EVENT HANDLERS + CRON SYNC
    │   │                           #   handleProduct*, handleInventory*, handleOrder*
    │   │                           # Phase 1.3 — file lớn nhất
    │   │
    │   ├── query-reformulator.js   # [76 dòng] Rewrite "nó giá bao nhiêu?" → standalone query
    │   │                           # Phase 2.2
    │   │
    │   ├── embedding.client.js     # [81 dòng] Vietnamese SBERT (local ONNX CPU)
    │   │                           # Phase 1.2
    │   │
    │   ├── hf.client.js            # [71 dòng] HuggingFace Inference API wrapper (Phi-3)
    │   │                           # Pre-existing + enhanced
    │   │
    │   ├── intent.resolver.js      # [67 dòng] Keyword → intent classification (7 intents)
    │   │                           # Phase 4.1 — thêm RECOMMENDATION
    │   │
    │   └── api.client.js           # [105 dòng] S2S HTTP client (Catalog/Inventory/Order/Auth)
    │                               # Phase 1.5 — auto JWT, response unwrap
    │
    ├── repositories/
    │   ├── chat.repository.js      # [82 dòng] CRUD chat_session + chat_message
    │   │                           # Pre-existing
    │   │
    │   ├── knowledge.repository.js # [124 dòng] DUAL SEARCH: pgvector cosine + tsvector FTS
    │   │                           # Phase 2.1
    │   │
    │   └── copurchase.repository.js # [79 dòng] Co-purchase pairs UPSERT + bidirectional lookup
    │                               # Phase 3.1
    │
    └── ws/
        └── chat.handler.js         # [170 dòng] Socket.IO: auth + events + typing indicator
                                    # Phase 4.4

Tổng: 15 files, ~2,035 dòng code
```

---

## 7. CROSS-SERVICE INTEGRATION & PATTERN COMPLIANCE

### 7.1. API Response Format Compliance

| Service | Pattern | Chatbot parsing |
|---------|---------|----------------|
| Catalog GET /api/products | `{ success, data: { products } }` | `result.data.products` ✅ |
| Catalog sản phẩm fields | camelCase: `unitPrice`, `categoryName`, `isActive` | Dùng camelCase ✅ |
| Inventory GET /summary | `{ success, data: [...] }` (direct array, camelCase) | `Array.isArray(result.data)` ✅ |
| Auth GET /api/stores | `{ status: 'success', data: { stores: [...] } }` | `result.data.stores` ✅ |

### 7.2. Idempotency Pattern

Thống nhất với inventory, order, payment:

```
Pattern: INSERT INTO processed_events ... → catch 23505 → skip
Schema: UNIQUE(event_id, service_name) — cho phép multi-service shared DB  
```

### 7.3. Event Type Constants

Chatbot subscribes 6 events:

```javascript
EVENT.PRODUCT_CREATED     // product.created
EVENT.PRODUCT_UPDATED     // product.updated
EVENT.PRODUCT_DELETED     // product.deleted
EVENT.PRODUCT_PRICE_CHANGED // product.price_changed
EVENT.INVENTORY_UPDATED   // inventory.updated
EVENT.ORDER_COMPLETED     // order.completed
```

### 7.4. Cross-Service Files Changed (ngoài chatbot)

| File | Thay đổi |
|------|---------|
| `catalog/src/services/product.service.js` | Thêm event publishing: `product.created/updated/deleted/price_changed` |
| `catalog/src/index.js` | Inject `eventBus` vào `ProductService` constructor |

---

## 8. DEPENDENCY GRAPH & FILE MAP

### 8.1. Dependency Flow

```
index.js
  ├── pool (shared/db)
  ├── eventBus (shared/event-bus)
  │
  ├── EmbeddingClient
  │     └── @xenova/transformers (Vietnamese SBERT)
  │
  ├── HFClient
  │     └── @huggingface/inference (Phi-3 cloud API)
  │
  ├── ApiClient
  │     └── shared/auth-middleware (generateToken for S2S)
  │
  ├── ChatRepository ← pool
  ├── KnowledgeRepository ← pool
  ├── CoPurchaseRepository ← pool
  │
  ├── DataIngestionService ← pool, EmbeddingClient, ApiClient
  │
  ├── QueryReformulator ← HFClient
  │
  ├── RAGService ← KnowledgeRepo, CoPurchaseRepo, EmbeddingClient, HFClient, ApiClient, Reformulator
  │
  ├── ChatService ← ChatRepo, HFClient, ApiClient, RAGService
  │
  ├── app.js ← ChatService, KnowledgeRepo
  │     ├── chat.routes ← ChatService
  │     ├── health.routes
  │     └── /api/rag/stats ← KnowledgeRepo
  │
  └── ws/chat.handler ← ChatService
```

### 8.2. NPM Dependencies

```json
{
    "@huggingface/inference": "^3.6.0",   // Phi-3 cloud API
    "@xenova/transformers": "^2.17.0",     // Vietnamese SBERT local ONNX
    "node-cron": "^3.0.3",                // Cron fallback sync
    "pgvector": "^0.2.0",                 // PostgreSQL VECTOR type support
    "socket.io": "^4.8.0"                 // WebSocket real-time chat
}
```

---

## TÀI LIỆU LIÊN QUAN

| Tài liệu | Đường dẫn |
|----------|-----------|
| Kế hoạch triển khai (Plan) | `docs/chatbot/chatbot-rag-implementation-plan.md` |
| Báo cáo đồ án (không code) | `docs/chatbot/bao-cao-chatbot-rag.md` |
| README kỹ thuật | `services/chatbot/README.md` |
| Event type constants | `shared/event-bus/eventTypes.js` |
