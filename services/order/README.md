# Service 3: Order

> **Port:** `3003` · **DB:** `order_db` (Supabase) · **Message Bus:** RabbitMQ  
> **⚡ Saga Participant** — Event-driven status updates

## Tổng Quan

Service quản lý đơn hàng bán (Sale Orders). Tham gia **Saga Pattern** — nhận events từ Payment và Inventory để tự động cập nhật trạng thái đơn hàng.

## Kiến Trúc

```
order/src/
├── db/init.sql                    # Schema + migrations
├── index.js                       # Entrypoint + Event subscriptions
├── app.js                         # Express middleware
├── routes/
│   ├── order.routes.js            # CRUD đơn hàng
│   ├── order-detail.routes.js     # Chi tiết đơn hàng
│   └── health.routes.js
├── services/
│   └── order.service.js           # Business logic + Saga transitions
└── repositories/
    ├── order.repository.js
    └── order-detail.repository.js
```

## Database Schema

| Table | Mô tả | Multi-Tenancy |
|-------|--------|:---:|
| `sale_order` | Đơn hàng bán (status, payment_status, delivery_type) | ✅ `store_id` |
| `sale_order_detail` | Chi tiết đơn hàng (product snapshot, batch_id, quantity) | via FK |
| `processed_events` | Idempotency table cho Saga events | — |
| `outbox_events` | Transactional Outbox cho event publishing | — |

### Order Status Machine
```
draft → pending → reserved → shipping → delivered
  ↓        ↓         ↓          ↓
  └────────┴─────────┴──────────┴────→ cancelled → refunded
```

**Valid statuses:** `draft`, `pending`, `reserved`, `shipping`, `delivered`, `cancelled`, `refunded`

### Payment Status
`pending` → `partial` → `paid` → `partial_refund` → `refunded` | `failed`

### Delivery Types
- `pickup` — Khách lấy tại quầy (POS)
- `delivery` — Giao hàng

## API Endpoints

### Orders
| Method | Endpoint | Auth | Mô tả |
|--------|----------|:----:|-------|
| `GET` | `/api/orders` | 🔑 | Danh sách đơn hàng (filter: status, payment, delivery) |
| `GET` | `/api/orders/:id` | 🔑 | Chi tiết đơn hàng |
| `POST` | `/api/orders` | 🔑 | Tạo đơn hàng (draft — offline POS) |
| `POST` | `/api/orders/online` | 🔑 | Tạo đơn online (pending → trigger Saga) |
| `PUT` | `/api/orders/:id` | 🔑 | Cập nhật đơn hàng |
| `PUT` | `/api/orders/:id/items` | 🔑 | Cập nhật chi tiết đơn hàng |
| `PATCH` | `/api/orders/:id/status` | 🔑 | Đổi trạng thái thủ công |
| `DELETE` | `/api/orders/:id` | 🔑 | Xóa đơn hàng (draft only) |
| `DELETE` | `/api/orders/bulk/draft` | 🔑 | Xóa tất cả draft orders |
| `POST` | `/api/orders/:id/refund` | 🔑 | Yêu cầu hoàn tiền |

### Order Details
| Method | Endpoint | Auth | Mô tả |
|--------|----------|:----:|-------|
| `GET` | `/api/order-details?orderId=X` | 🔑 | Chi tiết theo order ID |
| `GET` | `/api/order-details/:id` | 🔑 | Chi tiết theo detail ID |

## Event Subscriptions (Saga)

| Event | Source | Handler |
|-------|--------|---------|
| `payment.completed` | Payment Service | `status → delivered` (pickup) hoặc `shipping` (delivery); `payment_status → paid` |
| `payment.failed` | Payment Service | `status → cancelled`, `payment_status → failed` |
| `payment.timeout` | Payment Service | `status → cancelled` (VNPay expired) |
| `payment.refunded` | Payment Service | `payment_status → refunded / partial_refund` |
| `stock.reserved` | Inventory Service | `status → reserved` |
| `stock.reservation_failed` | Inventory Service | `status → cancelled` |
| `inventory.deduct_failed` | Inventory Service | `status → cancelled` |

## Event Publishing (Outbox)

| Event | Trigger | Data |
|-------|---------|------|
| `order.delivered` | Status → `delivered` (delivery orders only) | `{ orderId, storeId, items }` |
| `order.cancelled` | Status → `cancelled` (shipping orders) | `{ orderId, storeId, items }` |

## Logic Nghiệp Vụ

### 1. Pickup Flow (POS)
```
Admin tạo order (draft) → Admin thanh toán (Payment Service)
  → payment.completed event → Order: draft → delivered, paid
  → Inventory: deduct stock trực tiếp (on_shelf)
```

### 2. Delivery Flow (Online)
```
POST /orders/online → Order: pending
  → Inventory: reserve stock → stock.reserved → Order: reserved
  → Payment: VNPay URL → Customer pays → payment.completed
  → Order: reserved → shipping, paid
  → Admin xác nhận giao → PATCH status=delivered
  → order.delivered event → Inventory: confirm deduction
```

### 3. Saga Idempotency
- Mỗi event có `eventId` duy nhất
- `processed_events` table ngăn xử lý trùng lặp
- Transactional Outbox đảm bảo atomicity giữa DB commit và event publish

## Frontend Integration Notes

### Client-Side Join Pattern (Customer/Employee Resolution)

Backend `formatOrder()` returns only raw `customerId` (integer FK) -- it does NOT return a customer object.
Frontend `Orders.jsx` batch-resolves customer names via `customerService.getCustomerById(id)`.

| Enriched Field | Source | Description |
|---------------|--------|-------------|
| `_customerName` | Auth Service `/api/customers/:id` | Customer full name |
| `_customerPhone` | Auth Service `/api/customers/:id` | Customer phone |
| `_customerType` | Auth Service `/api/customers/:id` | guest / retail / wholesale / vip |
| `_createdByName` | Auth Service `/api/employees/:id` | Employee who created the order |

This is the same pattern used by `StockOuts.jsx` for employee name resolution.

### Response Format Differences

| Endpoint | Returns | Use Case |
|----------|---------|----------|
| `GET /orders` (list) | Order headers only -- NO `details[]` | Table/list views |
| `GET /orders/:id` (detail) | Full order + `details[]` (sale_order_detail JOIN) | Edit modal, payment items |

Components receiving an order from the list view will NOT have `order.details`.
If items are needed (e.g., for payment), fetch via `getOrderById()` separately.

### Type Coercion

`customerId` and `createdBy` are returned as **strings** from the API (PostgreSQL driver behavior).
Frontend must `parseInt()` before using as map keys or API parameters.

## Known Issues / Gotchas

| # | Issue | Status | Note |
|---|-------|--------|------|
| 1 | `customerId` returned as string | FIXED (frontend) | `parseInt()` applied in `Orders.jsx` enrichment |
| 2 | `formatOrder()` returned fake customer placeholder | FIXED | Removed -- frontend resolves via Client-Side Join |
| 3 | List endpoint missing `details[]` | By Design | `ViewOrderPaymentsModal` must fetch separately via `getOrderById` |
| 4 | `order.customer?.fullName` references in components | FIXED | Cleaned up in OrderList, EditOrderModal, ViewOrderPaymentsModal |

## Environment Variables
```env
PORT=3003
DATABASE_URL=postgresql://...
RABBITMQ_URL=amqps://...
JWT_SECRET=your-secret
INVENTORY_SERVICE_URL=http://inventory:3006
```
