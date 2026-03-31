# POSMART — Thiết Kế Database & Kiến Trúc Microservice

> **Phiên bản:** 6.0 (Multi-Tenancy 8 Services + AI Chatbot)  
> **Ngày cập nhật:** 2026-03-15  
> **Phương pháp:** Tuân theo nguyên tắc `@database-architect` + `@backend-specialist` + `@architecture`  
> **Database:** PostgreSQL cho tất cả 8 services

---

## Mục Lục

1. [Context Discovery](#1-context-discovery)
2. [Technology Stack](#2-technology-stack)
3. [Architecture Decision Records (ADR)](#3-architecture-decision-records-adr)
4. [Kiến Trúc Microservice — 8 Services](#4-kiến-trúc-microservice--8-services)
5. [Thiết Kế Database](#5-thiết-kế-database)
6. [Chi Tiết Từng Service](#6-chi-tiết-từng-service)
7. [Infrastructure](#7-infrastructure)
8. [Cross-Service Communication](#8-cross-service-communication)
9. [Tổng Kết](#9-tổng-kết)

---

## 1. Context Discovery

> Theo `architecture/context-discovery.md` — 5 câu hỏi BẮT BUỘC trước khi thiết kế.

| Câu hỏi | Trả lời |
|----------|---------|
| **Scale** | Chuỗi cửa hàng đa chi nhánh (Chain-level), < 100 stores |
| **Team** | Solo / 1-2 developers |
| **Timeline** | Không áp lực, ưu tiên học tập |
| **Domain** | POS system dạng chuỗi: Multi-Tenancy, CRUD-heavy + batch tracking + checkout flow + AI assistant |
| **Constraints** | PostgreSQL + Express.js, dùng Docker Compose cho dev |

---

## 2. Technology Stack

### 2.1 Core Stack

| Layer | Công nghệ | Phiên bản | Vai trò |
|-------|-----------|-----------|---------|
| **Runtime** | Node.js | 20 LTS | JavaScript runtime |
| **Framework** | Express.js | 4.21 | HTTP server, REST API |
| **Database** | PostgreSQL | 16 | Relational database (1 instance, 8 logical databases) |
| **Message Broker** | RabbitMQ | 3 | Event-driven communication (topic exchange) |
| **Cache** | Redis | Cloud | Session cache, rate limiting |
| **API Gateway** | Nginx | Alpine | Reverse proxy, load balancing |
| **Container** | Docker Compose | v2 | Orchestration cho local dev |

### 2.2 Shared Libraries (`@posmart/shared`)

| Package | Phiên bản | Vai trò |
|---------|-----------|---------|
| `pg` | 8.13 | PostgreSQL client (connection pooling) |
| `amqplib` | 0.10 | RabbitMQ client (AMQP 0-9-1) |
| `jsonwebtoken` | 9.0 | JWT sign/verify cho authentication |
| `pino` + `pino-pretty` | 9.4 / 11.3 | Structured JSON logging |

### 2.3 Service-Level Dependencies

| Package | Dùng ở | Vai trò |
|---------|--------|---------|
| `express` | Tất cả | HTTP framework |
| `helmet` | Tất cả | Security headers |
| `cors` | Tất cả | Cross-Origin Resource Sharing |
| `bcrypt` | Auth | Password hashing (Blowfish) |
| `express-rate-limit` | Auth, Chatbot | Brute-force protection |
| `@huggingface/inference` | Chatbot | Hugging Face Inference API client |

### 2.4 Dev & Testing

| Package | Vai trò |
|---------|---------|
| `jest` 30.x | Unit + Integration test runner |
| `supertest` 7.x | HTTP assertion (API testing) |

### 2.5 Cloud Services

| Service | Provider | Vai trò |
|---------|----------|---------|
| **PostgreSQL** | Supabase | Production database (managed) |
| **RabbitMQ** | CloudAMQP | Production message broker (managed) |
| **Redis** | Redis Cloud | Cache + rate limit store |
| **AI Inference** | Hugging Face | AI model API (Phi-3 / Mistral-7B) |
| **Payment Gateway** | VNPay | Thanh toán online (sandbox + production) |

---

## 3. Architecture Decision Records (ADR)

### ADR-009: Tái cấu trúc thành 7 Services (→ mở rộng thành 8)

| | |
|---|---|
| **Status** | Accepted → Extended (ADR-012) |
| **Context** | Hệ thống ban đầu 5 services, mở rộng lên 7 theo Enterprise pattern, nay thêm AI Chatbot |
| **Decision** | Cắt riêng: Catalog ↔ Inventory. Payment ↔ Order. Thêm Chatbot Service. |
| **Rationale** | Product (Read-heavy) vs Inventory (Write-heavy). Payment cần SLA riêng. Chatbot cần isolation vì external API dependency (HF) |

### ADR-010: Multi-Tenancy Strategy

| | |
|---|---|
| **Status** | Accepted |
| **Decision** | **Row-Level Security** (Shared DB, Shared Schema). Inject `store_id` vào các bảng nghiệp vụ. |
| **Rationale** | < 100 stores, cross-store reporting, đơn giản vận hành cho small team |

### ADR-011: Tenancy Scope Boundaries

| | |
|---|---|
| **Status** | Accepted |
| **Decision** | Catalog: **Centralized**. Customer: **Chain-level**. Employee: **Fixed per store**. Settings: **Chain-wide**. |

### ADR-012: AI Chatbot Service

| | |
|---|---|
| **Status** | Accepted |
| **Context** | Cần chatbot AI hỗ trợ cả Customer (web) lẫn Employee (POS), có khả năng truy vấn dữ liệu hệ thống |
| **Decision** | Tạo Service 8 (Chatbot, :3008) dùng Hugging Face Inference API (cloud). Kiến trúc RAG + Function Calling. |
| **Rationale** | Cloud API = zero GPU, chi phí thấp ($9/mo PRO), phù hợp giai đoạn đầu. Function Calling cho phép chatbot gọi internal APIs để trả lời câu hỏi thực tế (tồn kho, giá, đơn hàng). |

---

## 4. Kiến Trúc Microservice — 8 Services

### 4.1 Service Map

```
┌──────────────────────────────────────────────────────────────────┐
│                       NGINX API GATEWAY (:8080)                   │
│                                                                    │
│   /api/auth/*        → Auth         (:3001)                       │
│   /api/catalog/*     → Catalog      (:3002)   ← Centralized      │
│   /api/orders/*      → Order        (:3003)   ← Multi-Tenant     │
│   /api/settings/*    → Settings     (:3004)   ← Chain-wide       │
│   /api/suppliers/*   → Supplier     (:3005)   ← Multi-Tenant     │
│   /api/inventory/*   → Inventory    (:3006)   ← Multi-Tenant     │
│   /api/payments/*    → Payment      (:3007)   ← Multi-Tenant     │
│   /api/chat/*        → AI Chatbot   (:3008)   ← NEW (HF Cloud)   │
└──────────────────────────────────────────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────────────────────────────┐
│                    8 MICROSERVICES (Multi-Tenancy)                 │
│                                                                    │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐   │
│  │ [1] Auth :3001   │  │ [2] Catalog:3002│  │ [3] Order :3003 │   │
│  │ store, employee, │  │ category,       │  │ sale_order,     │   │
│  │ customer, roles  │  │ product,        │  │ sale_order_     │   │
│  │                  │  │ price_history   │  │ detail          │   │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘   │
│                                                                    │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐   │
│  │ [4] Settings    │  │ [5] Supplier    │  │ [6] Inventory   │   │
│  │ :3004           │  │ :3005           │  │ :3006           │   │
│  │ sales_settings, │  │ supplier,       │  │ product_batch,  │   │
│  │ security_       │  │ purchase_order, │  │ location,       │   │
│  │ settings        │  │ po_detail       │  │ inventory_item, │   │
│  └─────────────────┘  └─────────────────┘  │ stock_out       │   │
│                                             └─────────────────┘   │
│  ┌─────────────────┐  ┌─────────────────────────────────────┐     │
│  │ [7] Payment     │  │ [8] AI Chatbot :3008                │     │
│  │ :3007           │  │ chat_session, chat_message           │     │
│  │ payment,        │  │ HF Inference API (cloud)             │     │
│  │ vnpay_txn       │  │ Function Calling → Services 1-7     │     │
│  └─────────────────┘  └─────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────┘
                │
                ▼
┌──────────────────────────────────────────────────────────────────┐
│                        INFRASTRUCTURE                             │
│                                                                    │
│  ┌────────────┐  ┌────────────┐  ┌──────────────────────────┐     │
│  │ RabbitMQ   │  │ Redis      │  │ PostgreSQL (8 databases) │     │
│  │ (Event Bus)│  │ (Cache)    │  │ auth_db, catalog_db,     │     │
│  │            │  │            │  │ order_db, settings_db,   │     │
│  │            │  │            │  │ supplier_db, inventory_db│     │
│  │            │  │            │  │ payment_db, chatbot_db   │     │
│  └────────────┘  └────────────┘  └──────────────────────────┘     │
│                                                                    │
│  ┌──────────────────────────────────────────┐                     │
│  │ Hugging Face Inference API (External)    │                     │
│  │ Model: Phi-3-mini / Mistral-7B-Instruct  │                     │
│  └──────────────────────────────────────────┘                     │
└──────────────────────────────────────────────────────────────────┘
```

---

## 5. Thiết Kế Database

### 5.1 Database Ownership

1 PostgreSQL instance, 8 logical databases:

| # | Service | Port | Database | Bảng chính | Tenancy `store_id` |
|---|---------|------|----------|------------|:------------------:|
| 1 | Auth & Identity | 3001 | `auth_db` | `store`, `permission`, `role`, `role_permission`, `user_account`, `employee`, `customer`, `auth_tokens`, `pos_auth` | `employee` |
| 2 | Catalog | 3002 | `catalog_db` | `category`, `product`, `product_price_history` | — (Centralized) |
| 3 | Order | 3003 | `order_db` | `sale_order`, `sale_order_detail` | `sale_order` |
| 4 | Settings | 3004 | `settings_db` | `security_settings`, `sales_settings`, `settings_history` | — (Chain-wide) |
| 5 | Supplier | 3005 | `supplier_db` | `supplier`, `purchase_order`, `purchase_order_detail` | `purchase_order` |
| 6 | Inventory | 3006 | `inventory_db` | `product_batch`, `warehouse_block`, `location`, `inventory_item`, `inventory_movement`, `stock_out_order`, `stock_out_detail` | `product_batch`, `warehouse_block`, `stock_out_order` |
| 7 | Payment | 3007 | `payment_db` | `payment`, `vnpay_transaction` | `payment` |
| 8 | AI Chatbot | 3008 | `chatbot_db` | `chat_session`, `chat_message` | — (user-level) |

**Tổng: 8 databases, 30 tables**

### 5.2 Status State Machines

#### Sale Order (`sale_order.status`)

```
draft → completed → shipping → delivered
  ↘ cancelled     ↘ cancelled    ↘ refunded
```

| Status | Ý nghĩa | Trigger |
|--------|---------|---------|
| `draft` | Đơn vừa tạo, chưa thanh toán | POS cart → create draft |
| `completed` | Đã thanh toán thành công | Event `payment.completed` |
| `shipping` | Đang giao (delivery only) | NV confirm giao cho shipper |
| `delivered` | Giao thành công | Shipper confirm |
| `cancelled` | Hủy đơn | Admin action |
| `refunded` | Hoàn tiền | Post-delivery refund |

#### Purchase Order (`purchase_order.status`)

```
draft → approved → received
  ↘ cancelled   ↘ cancelled
```

| Status | Ý nghĩa | Trigger |
|--------|---------|---------|
| `draft` | PO vừa tạo, chưa duyệt | NV tạo PO |
| `approved` | Manager đã duyệt, sẵn sàng nhập | Manager approve |
| `received` | Đã nhập hàng → Inventory cập nhật | POST /:id/receive |
| `cancelled` | Hủy PO | Admin action |

---

## 6. Chi Tiết Từng Service

### 6.1 Auth & Identity Service (:3001)

| | |
|---|---|
| **Domain** | Identity (User, POS), RBAC, HR (Employee), CRM (Customer), Store management |
| **Đặc thù** | Tenancy Source of Truth — bảng `store` sinh ra ID cho toàn hệ thống |
| **Dependencies** | `bcrypt`, `express-rate-limit`, `jsonwebtoken` |
| **Public APIs** | `POST /register-trial` (tạo chain owner + store), `POST /register-customer` (customer self-signup) |
| **JWT Payload** | `{ id, role, storeId }` — `storeId` inject vào mọi request downstream |

### 6.2 Catalog Service (:3002)

| | |
|---|---|
| **Domain** | Quản lý hàng hoá (Categories, Products, Price History) |
| **Đặc thù** | **Read-heavy, Centralized** — không có `store_id`, HQ quản lý |
| **Cache** | Redis cho product listing (future) |

### 6.3 Order Service (:3003)

| | |
|---|---|
| **Domain** | Luồng business Đơn hàng bán ra (State Machine: draft→completed→shipping→delivered) |
| **Đặc thù** | Multi-tenant (`store_id`). Subscribe `payment.completed` để cập nhật status |
| **Events** | Subscribes: `payment.completed` |

### 6.4 Settings Service (:3004)

| | |
|---|---|
| **Domain** | Cấu hình toàn chuỗi (Sales Settings, Security Settings) |
| **Đặc thù** | **Chain-wide** — không có `store_id`. Trace-log jsonb history |

### 6.5 Supplier Service (:3005)

| | |
|---|---|
| **Domain** | Quản lý NCC & Quy trình thu mua PO (draft→approved→received) |
| **Đặc thù** | PO mang `store_id`. Supplier là chain-wide |
| **Events** | Publishes: `po.received` (future — khi nhập hàng xong) |

### 6.6 Inventory Service (:3006)

| | |
|---|---|
| **Domain** | Warehouse Management — Batches, Locations, Stock Movement, Stock-out |
| **Đặc thù** | **Write-heavy**, Transaction locking nghiêm ngặt. `store_id` ở mọi bảng |
| **Events** | Subscribes: `payment.completed` → `deductStock()` (trừ kho khi POS checkout) |
| **Core Methods** | `receiveStock()` (nhập), `deductStock()` (xuất POS), `adjustStock()` (điều chỉnh) |

### 6.7 Payment Service (:3007)

| | |
|---|---|
| **Domain** | Transactions, 3rd Party Webhooks (VNPay), Replay attack handling |
| **Đặc thù** | SLA cao, security critical. Tách khỏi Order để dễ integrate cổng TT mới |
| **Events** | Publishes: `payment.completed`, `payment.failed` |
| **3rd Party** | VNPay Sandbox (IPN webhook + return URL) |

### 6.8 AI Chatbot Service (:3008) 🆕

| | |
|---|---|
| **Domain** | AI Assistant cho cả Customer (web) và Employee (POS/Admin) |
| **AI Provider** | Hugging Face Inference API (cloud) |
| **Model** | MVP: `microsoft/Phi-3-mini-4k-instruct`. Production: `mistralai/Mistral-7B-Instruct-v0.3` |
| **Kiến trúc** | **RAG + Function Calling** — Intent classifier → Internal API calls → AI format response |
| **Database** | `chatbot_db` — `chat_session` + `chat_message` (lưu lịch sử chat) |
| **Dependencies** | `@huggingface/inference`, `express-rate-limit` |

**Intents (Function Calling):**

| Intent | Keywords | Gọi Service nào |
|--------|----------|:---:|
| `CHECK_STOCK` | "còn hàng", "tồn kho" | Inventory :3006 |
| `CHECK_PRICE` | "giá bao nhiêu" | Catalog :3002 |
| `ORDER_STATUS` | "đơn hàng", "tracking" | Order :3003 |
| `SEARCH_PRODUCT` | "tìm", "gợi ý" | Catalog :3002 |
| `REPORT` | "báo cáo", "thống kê" | Multiple services |
| `FREE_CHAT` | Mọi thứ khác | HF Inference API |

**Phân quyền Chatbot:**

| User Type | Khả năng |
|-----------|----------|
| **Customer** (token, role=Customer) | Hỏi sản phẩm, giá, tracking đơn mình |
| **Employee** (token, storeId) | Tồn kho store mình, báo cáo, gợi ý |
| **Không đăng nhập** | FAQ cơ bản, rate-limited |

---

## 7. Infrastructure

### 7.1 Docker Compose (Local Dev)

```yaml
Infrastructure:
  - postgres:16-alpine    (port 5432, 8 databases)
  - rabbitmq:3-management (port 5672 + 15672 management UI)

Gateway:
  - nginx:alpine          (port 8080 → reverse proxy)

Services:
  - auth:3001, catalog:3002, order:3003, settings:3004
  - supplier:3005, inventory:3006, payment:3007, chatbot:3008
```

### 7.2 Cloud Production

| Component | Provider | URL |
|-----------|----------|-----|
| PostgreSQL | Supabase | `aws-1-ap-northeast-2.pooler.supabase.com` |
| RabbitMQ | CloudAMQP | `raccoon.lmq.cloudamqp.com` |
| Redis | Redis Cloud | `redis-11417.crce178.ap-east-1-1.ec2.cloud.redislabs.com` |
| AI Inference | Hugging Face | `api-inference.huggingface.co` |
| Payment | VNPay | `sandbox.vnpayment.vn` |

---

## 8. Cross-Service Communication

### 8.1 RabbitMQ Event Bus

Exchange: `posmart.events` (topic, durable)

| Event | Publisher | Subscribers | Data |
|-------|----------|-------------|------|
| `payment.completed` | Payment :3007 | Order :3003, Inventory :3006 | `{ orderId, storeId, amount, method }` |
| `payment.failed` | Payment :3007 | Order :3003 | `{ orderId, storeId, reason }` |
| `po.received` | Supplier :3005 | Inventory :3006 | `{ storeId, items[] }` (future) |

### 8.2 POS Checkout SAGA (Choreography)

```
POS Client
    │
    ├─1→ Order Service: POST /api/orders     → draft (payment_status: pending)
    │
    ├─2→ Payment Service: POST /api/payments → completed
    │         │
    │         └─→ publish("payment.completed")
    │                    │
    │              ┌─────┴──────┐
    │              ▼            ▼
    │     Order Service    Inventory Service
    │     draft→completed  deductStock()
    │
    └─3← Response: payment + order confirmed
```

### 8.3 Chatbot ↔ Internal APIs (HTTP)

```
User Message → Chatbot :3008
                  │
           Intent Classifier
                  │
    ┌─────────────┼──────────────┐
    ▼             ▼              ▼
 Catalog API   Inventory API   HF Cloud
 :3002         :3006            API
    │             │              │
    └─────────────┼──────────────┘
                  ▼
           AI Response Generator
                  │
                  ▼
           User ← Formatted Response
```

---

## 9. Tổng Kết

Kiến trúc **8 Services + Multi-Tenancy + AI Chatbot** mở rộng từ phiên bản 7-service Enterprise, bổ sung khả năng trợ lý AI cho cả khách hàng và nhân viên. Hệ thống sử dụng cloud services (Supabase, CloudAMQP, Redis Cloud, Hugging Face) cho production và Docker Compose cho local dev, đảm bảo vận hành đơn giản cho small team.

| Metric | Giá trị |
|--------|---------|
| **Tổng services** | 8 |
| **Tổng databases** | 8 |
| **Tổng tables** | 30 |
| **Tables có `store_id`** | 7 |
| **Events (RabbitMQ)** | 3 |
| **External APIs** | 2 (VNPay, Hugging Face) |
| **Cloud services** | 5 (Supabase, CloudAMQP, Redis, HF, VNPay) |
