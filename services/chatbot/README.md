# Service 8: AI Chatbot

> **Port:** `3008` -- **DB:** `chatbot_db` (Supabase + pgvector) -- **Message Bus:** RabbitMQ
> **AI-Powered** -- RAG (Retrieval-Augmented Generation) Architecture

## Overview

Service chatbot AI for employee and customer support. Uses **RAG architecture** combining:
- **Vietnamese SBERT** embedding model (768d, runs locally on CPU via ONNX Runtime)
- **pgvector** for vector similarity search with metadata filtering
- **Event-Driven Sync** from Catalog/Inventory/Order to maintain knowledge base
- **Personalization** based on customer_type (VIP / wholesale / retail)
- **Co-purchase recommendation** from order history analysis

> Full technical report: `docs/chatbot/bao-cao-chatbot-rag.md`
> Implementation plan: `docs/chatbot/chatbot-rag-implementation-plan.md`

## Architecture

```
chatbot/src/
├── db/init.sql                    # Schema (sessions + messages + knowledge base + pgvector)
├── index.js                       # Entrypoint + Event subscriptions (RAG sync)
├── app.js                         # Express + WebSocket
├── routes/
│   ├── chat.routes.js             # Chat API endpoints
│   └── health.routes.js
├── services/
│   ├── chat.service.js            # Chat orchestrator (intent -> action -> response)
│   ├── rag.service.js             # RAG pipeline (embed -> search -> generate)
│   ├── intent.resolver.js         # Intent classification (keyword-based)
│   ├── embedding.client.js        # Vietnamese SBERT (local, @xenova/transformers)
│   ├── hf.client.js               # Hugging Face Inference API (LLM)
│   └── api.client.js              # Internal microservice HTTP client
└── ws/                            # WebSocket handler (real-time chat)
```

## Database Schema

| Table | Description |
|-------|-------------|
| `product_knowledge_base` | Vector embeddings (768d) per product per store. Core RAG table |
| `co_purchase_stats` | Products frequently bought together (from order.completed events) |
| `chat_session` | Chat sessions (user_id, user_type, store_id, customer_id) |
| `chat_message` | Messages (role: user/assistant/system, intent, metadata) |
| `processed_events` | Saga idempotency for event-driven sync |

### product_knowledge_base (Core RAG Table)

| Column | Type | Description |
|--------|------|-------------|
| `product_id` | BIGINT | FK to catalog_db.product |
| `store_id` | BIGINT | Multi-tenancy (one record per product per store) |
| `content` | TEXT | Formatted text for embedding (Vietnamese natural language) |
| `embedding` | VECTOR(768) | Vietnamese SBERT embedding vector |
| `category_name` | TEXT | Cached category name |
| `unit_price` | NUMERIC | Cached price (Inventory batch price or Catalog price) |
| `is_in_stock` | BOOLEAN | Metadata filter for search |
| `quantity_on_shelf` | INT | Current shelf quantity |

**Indexes:**
- `HNSW` on `embedding` (vector_cosine_ops) -- fast similarity search
- B-Tree partial on `(store_id) WHERE is_in_stock = TRUE` -- metadata filtering
- B-Tree on `(product_id, store_id)` UNIQUE -- upsert optimization

### co_purchase_stats

| Column | Type | Description |
|--------|------|-------------|
| `product_id_a` | BIGINT | Source product |
| `product_id_b` | BIGINT | Co-purchased product |
| `store_id` | BIGINT | Per-store statistics |
| `co_purchase_count` | INT | Times purchased together (threshold >= 3 for recommendations) |

### User Types
- `customer` -- Customer-facing chat
- `employee` -- Employee support chat

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|:----:|-------------|
| `POST` | `/api/chat/sessions` | Yes | Create new chat session |
| `POST` | `/api/chat/sessions/:id/messages` | Yes | Send message (triggers AI response) |
| `GET` | `/api/chat/sessions/:id/messages` | Yes | Message history |
| `PATCH` | `/api/chat/sessions/:id/end` | Yes | End chat session |
| `WS` | `/ws/chat` | -- | WebSocket real-time chat |

## Event Subscriptions (RAG Data Sync)

| Event | Source | Handler |
|-------|--------|---------|
| `product.created` | Catalog Service | Create record in knowledge base, embed and store vector |
| `product.updated` | Catalog Service | Update content, re-embed vector |
| `product.deleted` | Catalog Service | Remove from knowledge base |
| `inventory.updated` | Inventory Service | Update `is_in_stock`, `quantity_on_shelf` |
| `order.completed` | Order Service | Analyze co-purchase pairs, UPSERT into co_purchase_stats |

### Sync Mechanism

Primary: **Event-Driven** via RabbitMQ (near real-time)
Fallback: Cron job every 30 minutes (full-sync for missed events or service restarts)

## RAG Pipeline (5-Layer Processing)

### Layer 1: Intent Resolution
```
User message -> keyword matching -> classify intent
  "goi y bia ngon" -> intent: RECOMMENDATION -> RAGService
  "don hang #5 sao roi" -> intent: ORDER_STATUS -> HTTP API call
```

### Layer 2: Query Embedding
```
Vietnamese SBERT (local CPU, ONNX Runtime)
  Input: user message text
  Output: 768-dimensional vector
```

### Layer 3: Vector Search + Metadata Filtering
```sql
SELECT *, embedding <=> $query_vector AS distance
FROM product_knowledge_base
WHERE store_id = $store_id
  AND is_in_stock = TRUE
ORDER BY embedding <=> $query_vector
LIMIT 5;
```

### Layer 4: Co-purchase Enrichment
```
Top-5 products from vector search
  -> Query co_purchase_stats for each product
  -> Add "frequently bought together" products (count >= 3)
```

### Layer 5: Personalized Generation
```
Customer profile (from Auth Service: customer_type, total_spent)
  + Product data (from vector search + co-purchase)
  + System prompt (personalization rules per customer type)
  -> Phi-3-mini LLM (HuggingFace Inference API)
  -> Natural language response in Vietnamese
```

## Intent Table

| Intent | Trigger Keywords | Handler | Data Source | Method |
|--------|-----------------|---------|-------------|--------|
| RECOMMENDATION | goi y, recommend, tu van, nen mua | `_handleRecommendation()` | knowledge_base + co_purchase + customer profile | RAG |
| CHECK_STOCK | ton kho, con hang, het hang | `_handleCheckStock()` | Inventory API | HTTP |
| CHECK_PRICE | gia, bao nhieu, gia ban | `_handleCheckPrice()` | Catalog API | HTTP |
| ORDER_STATUS | don hang, order, tracking | `_handleOrderStatus()` | Order API | HTTP |
| SEARCH_PRODUCT | tim, search, san pham nao | `_handleSearchProduct()` | Catalog API (ILIKE) | HTTP |
| HELP | help, giup, huong dan | `_handleHelp()` | Static text | Local |
| FREE_CHAT | (fallback) | `_handleFreeChat()` | HuggingFace LLM | LLM only |

## Personalization Rules

| Customer Type | Prompt Modifier | Product Focus |
|--------------|----------------|---------------|
| VIP (`total_spent > 5M`) | Premium products, notify VIP discount | High-end, imported |
| Wholesale | Bulk quantities, wholesale pricing | Cases/packs, high volume |
| Retail (default) | Good value, daily deals | Popular, affordable |

## Cross-Service HTTP Calls (On-demand)

| Service | URL | Purpose |
|---------|-----|---------|
| Catalog | `http://catalog:3002` | Product lookup |
| Inventory | `http://inventory:3006` | Real-time stock check |
| Order | `http://order:3003` | Order status lookup |
| Auth | `http://auth:3001` | Customer profile (for personalization) |

## AI Models

| Component | Model | Runtime | Purpose |
|-----------|-------|---------|---------|
| Embedding | `keepitreal/vietnamese-sbert` | Local CPU (ONNX, `@xenova/transformers`) | Query + document embedding (768d) |
| Generation | `microsoft/Phi-3-mini-4k-instruct` | HuggingFace Inference API (cloud) | Natural language response generation |

## Multi-Tenancy

Chat sessions store `store_id` from JWT. All RAG queries filter by `store_id`:
- Product A may be in-stock at Store 1 but out-of-stock at Store 2
- Each store has separate `product_knowledge_base` records
- Co-purchase stats are also per-store

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
