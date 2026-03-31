# POSMART — Microservice Implementation Progress

> **Cập nhật lần cuối:** 2026-03-15  
> **Kiến trúc:** 8 Microservices + Multi-Tenancy (Row-Level) + AI Chatbot  
> **Database:** PostgreSQL (1 instance, 8 logical databases)  
> **Stack:** Express.js, pg, Jest, Supertest, RabbitMQ, Docker Compose, Hugging Face Inference API

---

## Tổng Quan Kiến Trúc

| # | Service | Port | Database | Trạng thái |
|---|---------|------|----------|:----------:|
| 1 | **Auth & Identity** | :3001 | `auth_db` | ✅ Hoàn thành (Multi-Tenancy + registerTrial/Customer) |
| 2 | **Catalog** | :3002 | `catalog_db` | ✅ Hoàn thành (Centralized) |
| 3 | **Order** | :3003 | `order_db` | ✅ Hoàn thành (Multi-Tenant, status: draft→completed→shipping→delivered) |
| 4 | **Settings** | :3004 | `settings_db` | ✅ Hoàn thành (Chain-wide) |
| 5 | **Supplier** | :3005 | `supplier_db` | ✅ Hoàn thành (Multi-Tenant, status: draft→approved→received) |
| 6 | **Inventory** | :3006 | `inventory_db` | ✅ Hoàn thành (Multi-Tenant, Write-heavy) |
| 7 | **Payment** | :3007 | `payment_db` | ✅ Hoàn thành (VNPay + Direct, event publish) |
| 8 | **AI Chatbot** | :3008 | `chatbot_db` | 📋 Planned (HF Inference API) |

---

## Architecture Decision Records (ADR)

### ADR-001: Gộp 10-12 services thành 5
- **Trạng thái:** ~~Accepted~~ → **Superseded by ADR-009**

### ADR-009: Tái cấu trúc thành 7 Services
- **Trạng thái:** Accepted
- **Quyết định:** Tách Product/Inventory và Order/Payment thành services riêng
- **Lý do:** Product (Read-heavy) vs Inventory (Write-heavy) có workload pattern khác nhau. Payment cần isolation do sensitive 3rd-party integration.

### ADR-010: Multi-Tenancy Strategy
- **Trạng thái:** Accepted
- **Quyết định:** Row-Level Security (Shared DB, Shared Schema, `store_id` column)
- **Lý do:** < 100 stores, cần cross-store reporting, đơn giản vận hành

### ADR-011: Tenancy Scope
- **Trạng thái:** Accepted
- **Quyết định:**
  - Catalog: **Centralized** (HQ quản lý)
  - Employee: **Fixed** (1 NV → 1 Store)
  - Customer: **Chain-level** (không có `store_id`)
  - Settings: **Chain-wide**

---

## Tiến Độ Chi Tiết

### ✅ Phase 1-8: Triển khai 5 Services gốc (Hoàn thành)

| Phase | Nội dung | Test |
|-------|---------|------|
| Phase 5 | Auth & Customer Service (v1) | ✅ All passed |
| Phase 6 | Product & Inventory Service (v1) | ✅ All passed |
| Phase 6.5 | Order & Payment Service (v1) | ✅ 42/42 passed |
| Phase 7.5 | Supplier Service | ✅ 23/23 passed |
| Phase 8 | Settings Service | ✅ 15/15 passed |

---

### 🔄 Phase 9: Multi-Tenancy + Service Decomposition

#### Phase 9.1: Cập nhật Schema SQL
Viết lại file `.sql` cho 7 services (fresh, không migration).

- [x] `service1.sql` — Thêm bảng `store`, thêm `store_id` vào `employee`
- [x] `service2-catalog.sql` — Tách: `category`, `product`, `product_price_history`
- [x] `service3-order.sql` — Tách order khỏi payment, thêm `store_id` vào `sale_order`
- [x] `service4.sql` — Giữ nguyên (chain-wide settings)
- [x] `service5.sql` — Thêm `store_id` vào `purchase_order`
- [x] `service6-inventory.sql` — Tách: batches, warehouse, movements, stock-out + `store_id`
- [x] `service7-payment.sql` — Tách: `payment`, `vnpay_transaction` + `store_id`

#### Phase 9.2: Cập nhật Architecture Doc
- [x] Viết lại `MODEL_ANALYSIS_AND_MICROSERVICE.md` (7 services + multi-tenancy)

#### Phase 9.3: Dựng lại Microservices Code
- [x] Service 2 (Catalog) — Service mới
- [x] Service 6 (Inventory) — Service mới
- [x] Service 7 (Payment) — Service mới
- [x] Cập nhật Service 1 (Auth) — Thêm `store` CRUD logic, `store_id` vào bảng query nhân sự
- [x] Cập nhật Service 3 (Order) — Bỏ payment, thêm `store_id` vào sale_order
- [x] Cập nhật Service 5 (Supplier) — Thêm `store_id` vào bảng `purchase_order`

#### Phase 9.4: Testing
- [x] Unit tests & Integration tests cho mỗi service (Hoàn tất toàn bộ 7 service)
- [x] Multi-tenancy isolation tests (đảm bảo store A không thấy data store B)

---

### ✅ Phase 10: Infrastructure & Integration
- [x] Docker Compose (PostgreSQL + RabbitMQ + 7 services + Nginx gateway)
- [x] Nginx API Gateway (routing cho 8 services, health checks)
- [x] Port alignment (Auth:3001 → Payment:3007, tất cả index.js + compose + nginx)
- [x] Schema updates (sale_order: bỏ pending, thêm completed. purchase_order: bỏ pending)
- [x] Pattern alignment (Payment, Inventory → shared/db + shared/logger + shared/event-bus)
- [x] RabbitMQ Event Wiring — Payment publishes `payment.completed` / `payment.failed`
- [x] Order subscribes `payment.completed` → status=completed, payment_status=paid
- [x] Inventory subscribes `payment.completed` → `deductStock()` trừ kho
- [x] Cross-service SAGA test (POS Checkout: 5/5 passed)

---

### 📋 Phase 11: AI Chatbot Service ✅
- [x] Service skeleton (Express + shared libs, port :3008)
- [x] Database schema (`chatbot_db`: chat_session, chat_message)
- [x] Intent classifier (regex/keyword: CHECK_STOCK, CHECK_PRICE, ORDER_STATUS, SEARCH_PRODUCT, HELP, FREE_CHAT)
- [x] HF Inference API integration (`@huggingface/inference` InferenceClient)
- [x] Chat history persistence (sessions + messages + getRecentContext)
- [x] Docker + Nginx routing (upstream chatbot:3008 + /api/chat/* + /ws/chat/)
- [x] Internal API calls (Catalog, Inventory, Order) via `api.client.js`
- [x] WebSocket real-time chat (Socket.IO + JWT auth + typing indicators)
- [x] Unit + Integration tests (56/56 ✅ — 5 suites)
- [ ] Frontend chat widget (deferred)

---

## Bảng `store_id` Analysis

> 7 bảng cần thêm `store_id`, 17 bảng giữ nguyên.

| Bảng | `store_id`? | Lý do |
|------|:-----------:|-------|
| `employee` | ✅ | Mỗi NV thuộc 1 store |
| `sale_order` | ✅ | Đơn hàng tại 1 store |
| `purchase_order` | ✅ | Nhập hàng cho 1 store |
| `product_batch` | ✅ | Lô hàng nhận tại 1 store |
| `warehouse_block` | ✅ | Kho riêng mỗi store |
| `stock_out_order` | ✅ | Xuất kho tại 1 store |
| `payment` | ✅ | Thanh toán tại 1 store |
| *Tất cả bảng còn lại* | ❌ | Chain-wide hoặc kế thừa từ bảng cha |

---

## Tài Liệu Liên Quan

- [MODEL_ANALYSIS_AND_MICROSERVICE.md](./database-design/MODEL_ANALYSIS_AND_MICROSERVICE.md) — Thiết kế tổng thể
- [auth-customer-workflow.md](./auth-customer-workflow.md) — Luồng hoạt động Service 1
- SQL Schemas: `docs/database-design/service*.sql`
