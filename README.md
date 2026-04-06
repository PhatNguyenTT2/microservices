# POSMART Microservices

> Hệ thống quản lý cửa hàng tiện lợi (POS) — Kiến trúc Microservices

## Tổng Quan Hệ Thống

```
                    ┌──────────────────┐
                    │   Frontend (SPA) │  Vite + React
                    │    :5173 (dev)   │
                    └────────┬─────────┘
                             │ /api/*
                    ┌────────▼─────────┐
                    │  API Gateway     │  Nginx (Rate Limiting)
                    │    :8080         │
                    └────────┬─────────┘
            ┌────────────────┼────────────────┐
            │                │                │
    ┌───────▼──────┐ ┌──────▼───────┐ ┌──────▼───────┐
    │  Auth :3001  │ │ Catalog:3002 │ │ Order :3003  │
    │  Identity    │ │ Products     │ │ Sale Orders  │
    │  RBAC        │ │ Categories   │ │ Saga ⚡      │
    └──────────────┘ └──────────────┘ └──────────────┘
    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
    │Settings:3004 │ │Supplier:3005 │ │Inventory:3006│
    │ Config       │ │ PO / NCC     │ │ Stock/Batch  │
    │ Singleton    │ │ Saga ⚡      │ │ Saga ⚡      │
    └──────────────┘ └──────────────┘ └──────────────┘
    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
    │Payment :3007 │ │Chatbot :3008 │ │Stats   :3009 │
    │ Cash/VNPay   │ │ AI (HF)      │ │ Dashboard    │
    │ Orchestrator⚡│ │ Intent-based │ │ Redis Cache  │
    └──────────────┘ └──────────────┘ └──────────────┘
```

## Infrastructure (Cloud-managed)

| Component | Provider | Mô tả |
|-----------|----------|-------|
| **PostgreSQL** | Supabase | Database cho tất cả services (shared instance, isolated schemas) |
| **RabbitMQ** | CloudAMQP | Message broker cho event-driven Saga |
| **Redis** | Redis Cloud | Cache cho Statistics service |
| **API Gateway** | Nginx (containerized) | Rate limiting + reverse proxy |

## Service Registry

| # | Service | Port | DB | Events | Mô tả |
|---|---------|------|:---:|:---:|-------|
| 1 | [Auth](services/auth/README.md) | 3001 | ✅ | — | Xác thực, RBAC, Store/Employee/Customer |
| 2 | [Catalog](services/catalog/README.md) | 3002 | ✅ | — | Sản phẩm, Danh mục, Lịch sử giá |
| 3 | [Order](services/order/README.md) | 3003 | ✅ | ⚡ Sub | Đơn hàng bán (Saga participant) |
| 4 | [Settings](services/settings/README.md) | 3004 | ✅ | — | Cấu hình bảo mật + chính sách bán hàng |
| 5 | [Supplier](services/supplier/README.md) | 3005 | ✅ | ⚡ Sub | Nhà cung cấp + Đơn nhập hàng (Saga participant) |
| 6 | [Inventory](services/inventory/README.md) | 3006 | ✅ | ⚡ Pub+Sub | Tồn kho, Kho bãi, Xuất kho (Saga core) |
| 7 | [Payment](services/payment/README.md) | 3007 | ✅ | ⚡ Pub | Thanh toán Cash/VNPay (**Saga Orchestrator**) |
| 8 | [Chatbot](services/chatbot/README.md) | 3008 | ✅ | — | AI Chatbot (Hugging Face) |
| 9 | [Statistics](services/statistics/README.md) | 3009 | ❌ | ⚡ Sub | Thống kê + Dashboard (Redis cache) |

## Saga Pattern (Event-Driven)

### Core Flow: Sale Order
```
                        ┌─────────────────────────────────┐
                        │        Payment Service          │
                        │        (Orchestrator)           │
                        └──────────┬──────────────────────┘
                                   │ payment.completed
                    ┌──────────────┼──────────────────────┐
                    ▼              ▼                      ▼
            ┌──────────┐   ┌────────────┐         ┌────────────┐
            │  Order   │   │ Inventory  │         │ Supplier   │
            │ Service  │   │  Service   │         │  Service   │
            ├──────────┤   ├────────────┤         ├────────────┤
            │ status → │   │ Pickup:    │         │ PO only:   │
            │ delivered│   │  deduct    │         │ payment_   │
            │ (pickup) │   │ Delivery:  │         │ status →   │
            │ shipping │   │  reserve   │         │ paid       │
            │ (deliv.) │   │            │         │            │
            └──────────┘   └─────┬──────┘         └────────────┘
                                 │
                    stock.reserved / deduct_failed
                                 │
                         ┌───────▼───────┐
                         │ Order Service │
                         │ status →      │
                         │ reserved /    │
                         │ cancelled     │
                         └───────────────┘
```

### Event Catalog
| Event | Publisher | Subscribers |
|-------|-----------|-------------|
| `payment.completed` | Payment | Order, Inventory, Supplier, Statistics |
| `payment.failed` | Payment | Order |
| `payment.refunded` | Payment | Order, Inventory, Supplier |
| `payment.timeout` | Payment | Order |
| `stock.reserved` | Inventory | Order |
| `stock.reservation_failed` | Inventory | Order |
| `inventory.deduct_failed` | Inventory | Order |
| `inventory.updated` | Inventory | Statistics, Chatbot (planned) |
| `inventory.low_stock` | Inventory | (planned) |
| `order.shipping` | Order | (internal state) |
| `order.delivered` | Order | Inventory |
| `order.cancelled` | Order | Inventory |
| `order.refunded` | Order | (internal state) |
| `product.created` | Catalog | Chatbot RAG (planned) |
| `product.updated` | Catalog | Chatbot RAG (planned) |
| `product.deleted` | Catalog | Chatbot RAG (planned) |
| `customer.created` | Auth | (planned for data replication) |
| `customer.updated` | Auth | (planned for data replication) |

### Patterns Used
- **Transactional Outbox** -- Event is written to DB in the same transaction, poller publishes via RabbitMQ
- **Saga Idempotency** -- `processed_events` table prevents duplicate processing
- **Compensation** -- `inventory.deduct_failed` -> Order reverts to `cancelled`

## Known Patterns

| Pattern | Where Used | Description |
|---------|-----------|-------------|
| Client-Side Join | Frontend (Orders, StockOuts) | Backend returns raw IDs; frontend batch-resolves names via API calls |
| Transactional Outbox | Payment, Order, Inventory | Event atomically written with DB update; poller publishes to RabbitMQ |
| Saga Idempotency | All event subscribers | `processed_events` table prevents reprocessing duplicate events |
| Singleton Config | Settings Service | Each config type has exactly 1 record (id=1) |
| Event Payload Contract | Payment -> Inventory | `items[]` MUST have data; if empty, Inventory skips deduction silently |
| Type Coercion | Frontend -> API | PostgreSQL returns numeric IDs as strings; frontend must `parseInt()` |
| RAG Pipeline | Chatbot Service | Vector embedding + pgvector search + LLM generation |

## Multi-Tenancy

| Level | Services |
|-------|----------|
| **Tenant-scoped** (store_id filter) | Order, Inventory, Payment, Supplier (PO), Chatbot (knowledge base) |
| **Chain-wide** (centralized) | Auth, Catalog, Settings |
| **No DB** | Statistics (API aggregation + Redis cache) |

JWT contains `storeId` -> middleware injects into request -> services filter data by store.

## Shared Infrastructure

```
shared/
├── auth-middleware/       # JWT verification middleware
├── common/
│   ├── logger.js         # Pino logger
│   └── errors.js         # Custom error classes (AppError, ValidationError, NotFoundError)
├── db/                   # PostgreSQL pool management (Supabase SSL support)
├── event-bus/            # RabbitMQ publisher/subscriber (topic exchange: posmart.events)
│   └── eventTypes.js     # ~30 event constants (prevents typos)
└── outbox/               # Transactional Outbox poller (1000ms interval)
```

## Rate Limiting (Gateway)

| Zone | Rate | Applied To |
|------|------|-----------|
| `strict` | 10 req/min | Auth, Chat, Online Orders |
| `standard` | 60 req/min | All CRUD endpoints |
| `ws_conn` | Connection limit | WebSocket |

## Documentation

| Document | Path | Description |
|----------|------|-------------|
| System Design Diagrams | `docs/system-design-diagrams.md` | Full architecture diagrams |
| Database Schema (SQL) | `docs/supabase_init_all.sql` | Combined schema for all services |
| Chatbot RAG Report | `docs/chatbot/bao-cao-chatbot-rag.md` | RAG architecture technical report |
| Chatbot Implementation Plan | `docs/chatbot/chatbot-rag-implementation-plan.md` | Detailed RAG implementation plan |
| Data Replication Plan | `docs/improve/data-replication-customer.md` | Future customer cache strategy |

## Quick Start

```bash
# 1. Copy environment variables
cp .env.example .env

# 2. Start all services
docker compose up --build

# 3. Frontend (separate terminal)
cd frontend && npm run dev

# Services available at:
# Frontend:  http://localhost:5173
# Gateway:   http://localhost:8080
# Auth:      http://localhost:3001
# ...
```

## Environment Variables

```env
# Database
DATABASE_URL=postgresql://user:pass@host:5432/db
DB_SSL=true

# Messaging
RABBITMQ_URL=amqps://user:pass@host/vhost

# Cache (Statistics only)
REDIS_URL=redis://user:pass@host:port

# Auth
JWT_SECRET=your-jwt-secret
JWT_EXPIRES_IN=7d

# VNPay (Payment only)
VNP_TMNCODE=your-merchant-code
VNP_HASHSECRET=your-hash-secret
VNP_URL=https://sandbox.vnpayment.vn
VNP_TEST_MODE=true

# AI Chatbot
HF_ACCESS_TOKEN=hf_xxxxxxxxxxxxx
HF_MODEL=microsoft/Phi-3-mini-4k-instruct
```
