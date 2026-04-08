# Service 8: AI Chatbot

> **Port:** `3008` · **DB:** `chatbot_db` (Supabase + pgvector) · **Message Bus:** RabbitMQ  
> **🤖 Advanced RAG** — Hybrid Search (pgvector + tsvector) + Personalization

## Tổng Quan

Service chatbot AI hỗ trợ nhân viên và khách hàng. Sử dụng kiến trúc **Advanced RAG** (Retrieval-Augmented Generation) kết hợp tìm kiếm ngữ nghĩa, tìm kiếm từ khóa, gợi ý mua kèm, và cá nhân hóa theo loại khách hàng. Dữ liệu sản phẩm được đồng bộ gần real-time qua **Event-Driven Sync** (RabbitMQ) + Cron fallback 30 phút.

## Kiến Trúc

```
chatbot/src/
├── db/init.sql                         # Schema (pgvector + tsvector + co-purchase + idempotency)
├── index.js                            # Entrypoint + Event subscriptions + Cron bootstrap
├── app.js                              # Express + rate limiter + RAG stats endpoint
├── routes/
│   ├── chat.routes.js                  # Chat REST API (sessions + messages)
│   └── health.routes.js
├── services/
│   ├── chat.service.js                 # Chat orchestrator (intent → handler → response)
│   ├── rag.service.js                  # RAG pipeline (reform → embed → hybrid search → RRF → generate)
│   ├── data-ingestion.service.js       # Event handlers + Cron full-sync cho knowledge base
│   ├── query-reformulator.js           # Viết lại câu hỏi mơ hồ qua Phi-3
│   ├── embedding.client.js             # Vietnamese SBERT (local CPU, ONNX, @xenova/transformers)
│   ├── intent.resolver.js              # Phân loại ý định (keyword-based)
│   ├── hf.client.js                    # HuggingFace Inference API (Phi-3 LLM)
│   └── api.client.js                   # HTTP client nội bộ (Catalog, Inventory, Order, Auth)
├── repositories/
│   ├── chat.repository.js              # CRUD sessions + messages
│   ├── knowledge.repository.js         # Dual search: pgvector (semantic) + tsvector (keyword)
│   └── copurchase.repository.js        # Co-purchase stats CRUD + lookup
└── ws/
    └── chat.handler.js                 # Socket.IO real-time chat
```

## Database Schema

| Table | Mô tả | Multi-Tenancy |
|-------|--------|:---:|
| `chat_session` | Phiên chat (user_id, user_type, store_id) | ✅ `store_id` |
| `chat_message` | Tin nhắn (role: user/assistant/system, intent, metadata) | via FK |
| `product_knowledge_base` | Vector embedding (768d) + FTS per product per store — bảng core RAG | ✅ `store_id` |
| `co_purchase_stats` | Thống kê sản phẩm thường mua cùng (từ order.completed) | ✅ `store_id` |
| `processed_events` | Saga idempotency cho event-driven sync | — |

### product_knowledge_base (Bảng Core RAG)

| Cột | Kiểu | Mô tả |
|-----|------|-------|
| `product_id` | BIGINT | Ref đến catalog_db.product (cross-service, không FK) |
| `store_id` | BIGINT | Multi-tenancy — mỗi sản phẩm mỗi chi nhánh 1 record |
| `content` | TEXT | Văn bản tiếng Việt đã format (đầu vào embedding + keyword) |
| `embedding` | VECTOR(768) | Vector Vietnamese SBERT |
| `fts_content` | TSVECTOR | Token full-text search (cho keyword search) |
| `category_name` | TEXT | Cache tên danh mục |
| `unit_price` | NUMERIC | Cache giá bán |
| `is_in_stock` | BOOLEAN | Metadata filter (lọc khi search) |
| `quantity_on_shelf` | INT | Số lượng trên kệ hiện tại |

**Chiến lược Index:**

| Index | Kiểu | Mục đích |
|-------|------|----------|
| `idx_pkb_embedding` | HNSW (`vector_cosine_ops`) | Tăng tốc vector similarity search |
| `idx_pkb_fts` | GIN (`fts_content`) | Tăng tốc keyword full-text search |
| `idx_pkb_store_stock` | B-Tree partial (`WHERE is_in_stock = TRUE`) | Metadata filtering theo store + tồn kho |
| `idx_pkb_product_store` | B-Tree UNIQUE | Tối ưu UPSERT khi đồng bộ |

### co_purchase_stats

| Cột | Kiểu | Mô tả |
|-----|------|-------|
| `product_id_a` | BIGINT | Sản phẩm gốc (sorted: a < b) |
| `product_id_b` | BIGINT | Sản phẩm mua kèm |
| `store_id` | BIGINT | Thống kê theo chi nhánh |
| `co_purchase_count` | INT | Số lần mua cùng (threshold ≥ 3 cho gợi ý) |

## API Endpoints

### Chat
| Method | Endpoint | Auth | Mô tả |
|--------|----------|:----:|-------|
| `POST` | `/api/chat/sessions` | 🔑 | Tạo phiên chat mới |
| `GET` | `/api/chat/sessions` | 🔑 | Danh sách phiên chat của user |
| `GET` | `/api/chat/sessions/:id` | 🔑 | Chi tiết phiên + tin nhắn |
| `POST` | `/api/chat/sessions/:id/end` | 🔑 | Kết thúc phiên chat |
| `POST` | `/api/chat/message` | 🔑 | Gửi tin nhắn (trigger AI response) |

### RAG / Monitoring
| Method | Endpoint | Auth | Mô tả |
|--------|----------|:----:|-------|
| `GET` | `/api/rag/stats` | — | Thống kê knowledge base (tổng records, per-store) |

### WebSocket
| Protocol | Path | Mô tả |
|----------|------|-------|
| `WS` | `/ws/chat` | Socket.IO real-time chat |

Rate limit: 20 requests/phút trên `/api/chat/*`

## Event Subscriptions (RAG Data Sync)

| Event | Source | Handler |
|-------|--------|---------|
| `product.created` | Catalog Service | Embed content → UPSERT vào knowledge base |
| `product.updated` | Catalog Service | Re-embed → UPDATE knowledge base |
| `product.deleted` | Catalog Service | DELETE khỏi knowledge base |
| `product.price_changed` | Catalog Service | Re-embed (delegate handleProductUpdated) |
| `inventory.updated` | Inventory Service | Cập nhật `is_in_stock`, `quantity_on_shelf` |
| `order.completed` | Order Service | Phân tích co-purchase pairs → UPSERT co_purchase_stats |

### Cơ chế Sync

```
Primary:  Event-Driven (RabbitMQ) — gần real-time
Fallback: Cron */30 * * * * — full-sync mỗi 30 phút
Startup:  Initial full-sync sau 10s delay (chờ services khác boot)
```

## Logic Nghiệp Vụ

### 1. RAG Pipeline (7 bước)

```
User message
  → [1] Intent Resolution: keyword matching → classify intent
  → [2] Query Reformulation: kiểm tra đại từ mơ hồ → Phi-3 viết lại
  → [3] Query Embedding: Vietnamese SBERT → vector 768d
  → [4] Hybrid Search: pgvector cosine ∥ tsvector FTS (song song)
  → [5] RRF Fusion: score(d) = SUM(1/(60+rank)) → Top 5
  → [6] Co-purchase Enrichment: lookup co_purchase_stats ≥ 3
  → [7] Personalized Generation: customer profile + RAG context → Phi-3 → response
```

### 2. Intent Table

| Intent | Từ khóa kích hoạt | Handler | Nguồn dữ liệu | Phương thức |
|--------|-------------------|---------|---------------|-------------|
| **RECOMMENDATION** | gợi ý, recommend, tư vấn, nên mua, có gì ngon | `_handleRecommendation()` | knowledge_base + co_purchase + customer profile | RAG |
| **CHECK_STOCK** | tồn kho, còn hàng, hết hàng | `_handleCheckStock()` | Inventory API | HTTP |
| **CHECK_PRICE** | giá, bao nhiêu, giá bán | `_handleCheckPrice()` | Catalog API | HTTP |
| **ORDER_STATUS** | đơn hàng, order, tracking | `_handleOrderStatus()` | Order API | HTTP |
| **SEARCH_PRODUCT** | tìm, search, sản phẩm nào | `_handleSearchProduct()` | Catalog API (ILIKE) | HTTP |
| **HELP** | help, giúp, hướng dẫn | `_handleHelp()` | Static text | Local |
| **FREE_CHAT** | *(fallback)* | `_handleFreeChat()` | HuggingFace LLM | LLM only |

### 3. Personalization

| Loại khách | Prompt bổ sung | Focus sản phẩm |
|-----------|----------------|---------------|
| VIP (`total_spent > 5M`) | Premium, thông báo giảm giá VIP | Cao cấp, nhập khẩu |
| Sỉ (wholesale) | Số lượng lớn, giá sỉ | Thùng/lốc, volume cao |
| Lẻ (retail, default) | Giá tốt, deal hôm nay | Phổ thông, giá rẻ |

### 4. Cross-Service Communication

| Service | URL | Mục đích | Khi nào |
|---------|-----|----------|---------|
| Catalog | `http://catalog:3002` | Danh sách/chi tiết sản phẩm | Sync + on-demand search |
| Inventory | `http://inventory:3006` | Tồn kho theo chi nhánh | Sync + kiểm tra stock |
| Order | `http://order:3003` | Tra cứu đơn hàng | Nghiệp vụ ORDER_STATUS |
| Auth | `http://auth:3001` | Customer profile, danh sách stores | Personalization + sync |

### 5. AI Models

| Thành phần | Model | Runtime | Vai trò |
|-----------|-------|---------|---------|
| Embedding | `keepitreal/vietnamese-sbert` | Local CPU (ONNX, `@xenova/transformers`) | Embed query + document (768d) |
| Generation | `microsoft/Phi-3-mini-4k-instruct` | HuggingFace Inference API (cloud) | Sinh câu trả lời + viết lại câu hỏi |

## Known Issues / Gotchas

| # | Vấn đề | Trạng thái | Ghi chú |
|---|--------|-----------|---------|
| 1 | Embedding model load lần đầu chậm (~30s) | By Design | Được cache sau lần đầu, startup delay 10s cho sync |
| 2 | RAG disabled nếu embedding model load fail | By Design | Fallback về HTTP API calls (không có semantic search) |
| 3 | `order.completed` chưa có trong eventTypes.js | Cần bổ sung | Co-purchase handler sẽ không nhận event cho đến khi thêm constant |
| 4 | Inventory `/summary` yêu cầu `verifyToken` | By Design | Cron sync cần service-level token hoặc internal bypass |

## Environment Variables
```env
PORT=3008
DATABASE_URL=postgresql://...
RABBITMQ_URL=amqps://...
JWT_SECRET=your-secret
HF_ACCESS_TOKEN=hf_xxxxxxxxxxxxx
HF_MODEL=microsoft/Phi-3-mini-4k-instruct
CATALOG_SERVICE_URL=http://catalog:3002
INVENTORY_SERVICE_URL=http://inventory:3006
ORDER_SERVICE_URL=http://order:3003
AUTH_SERVICE_URL=http://auth:3001
```
