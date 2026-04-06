# Service 7: Payment

> **Port:** `3007` · **DB:** `payment_db` (Supabase) · **Message Bus:** RabbitMQ  
> **⚡ Saga Orchestrator** — Publishes `payment.completed/refunded` events

## Tổng Quan

Service quản lý thanh toán (Payments) cho cả Sale Orders và Purchase Orders. Là **Saga Orchestrator** — khi trạng thái thanh toán thay đổi, publish events để các service khác (Order, Inventory, Supplier) cập nhật trạng thái tương ứng.

## Kiến Trúc

```
payment/src/
├── db/init.sql                         # Schema
├── index.js                            # Entrypoint + Outbox poller
├── app.js                              # Express middleware
├── routes/
│   └── payment.routes.js               # Routes (CRUD + VNPay + Direct + Refund)
├── services/
│   └── payment.service.js              # Core logic (Direct, VNPay, Refund)
└── repositories/
    └── payment.repository.js           # Data access
```

## Database Schema

| Table | Mô tả | Multi-Tenancy |
|-------|--------|:---:|
| `payment` | Giao dịch thanh toán (amount, method, status, reference) | ✅ `store_id` |
| `vnpay_transaction` | Chi tiết giao dịch VNPay | via FK |
| `processed_events` | Saga idempotency | — |
| `outbox_events` | Transactional Outbox | — |

### Payment Table
| Column | Type | Mô tả |
|--------|------|-------|
| `store_id` | BIGINT | Cửa hàng |
| `amount` | NUMERIC | Số tiền (> 0) |
| `method` | TEXT | `cash`, `card`, `bank_transfer`, `vnpay` |
| `status` | TEXT | `pending`, `completed`, `cancelled`, `refunded` |
| `reference_type` | TEXT | `SaleOrder` hoặc `PurchaseOrder` |
| `reference_id` | BIGINT | ID đơn hàng tham chiếu |
| `items` | JSONB | Snapshot items (cho inventory deduction) |
| `delivery_type` | TEXT | `pickup` hoặc `delivery` |
| `created_by` | BIGINT | NV thu tiền |

### VNPay Transaction
| Column | Mô tả |
|--------|-------|
| `payment_id` | FK → payment |
| `txn_ref` | Mã giao dịch VNPay |
| `vnp_transaction_no` | Số giao dịch trên VNPay |
| `bank_code` | Ngân hàng |
| `response_code` | Mã phản hồi VNPay |

## API Endpoints

| Method | Endpoint | Auth | Mô tả |
|--------|----------|:----:|-------|
| `GET` | `/api/payments` | ❌* | Danh sách payments (filter: reference, status, method) |
| `GET` | `/api/payments/:id` | ❌* | Chi tiết payment |
| `POST` | `/api/payments` | ❌* | Tạo payment pending (admin flow) hoặc VNPay URL |
| `POST` | `/api/payments/direct` | ❌* | **Pay & Complete** — tạo + hoàn thành ngay (trigger Saga) |
| `PUT` | `/api/payments/:id` | ❌* | Cập nhật payment (pending only) — đổi status → completed triggers Saga |
| `DELETE` | `/api/payments/:id` | ❌* | Xóa payment (pending/cancelled only) |
| `POST` | `/api/payments/:id/refund` | ❌* | Hoàn tiền (completed → refunded) |
| `GET` | `/api/payments/vnpay/return` | ❌ | VNPay redirect URL |
| `GET` | `/api/payments/vnpay/ipn` | ❌ | VNPay IPN callback |

> All endpoints use `verifyToken` middleware. `storeId` is extracted from JWT.

## Event Publishing (Outbox)

| Event | Trigger | Data |
|-------|---------|------|
| `payment.completed` | Status → `completed` (direct or manual) | `{ paymentId, orderId, storeId, referenceType, amount, method, items, deliveryType, totalPaidSoFar }` |
| `payment.failed` | VNPay IPN failure | `{ orderId, storeId, referenceType, reason }` |
| `payment.refunded` | Refund processed | `{ paymentId, orderId, storeId, referenceType, amount, allRefunded, items, deliveryType }` |
| `payment.timeout` | VNPay expired | `{ orderId, storeId, referenceType }` |

## Logic Nghiệp Vụ

### 1. Admin Flow (Pending → Complete)
```
POST /payments { referenceType: 'Order', referenceId: 5, amount: 100000, method: 'cash' }
  → DB: payment (status=pending)

PUT /payments/:id { status: 'completed' }
  → DB: payment (status=completed)
  → Outbox: payment.completed { orderId, items, deliveryType, totalPaidSoFar }
  → Poller → RabbitMQ → Order + Inventory + Supplier nhận event
```

### 2. Direct Payment (Pay & Complete)
```
POST /payments/direct { referenceType: 'Order', referenceId: 5, amount: 100000, method: 'cash' }
  → DB: payment (status=completed) — 1 step
  → Outbox: payment.completed { ... }
  → Saga triggered ngay lập tức
```

### 3. VNPay Flow
```
POST /payments { method: 'vnpay', amount: ..., referenceType: 'SaleOrder' }
  → DB: payment (pending) + vnpay_transaction
  → Response: { paymentUrl: 'https://sandbox.vnpayment.vn/...' }

Customer thanh toán → VNPay IPN callback:
GET /payments/vnpay/ipn?vnp_ResponseCode=00
  → Verify signature → DB: status=completed
  → Outbox: payment.completed
```

### 4. Refund Flow
```
POST /payments/:id/refund
  → DB: payment (status=refunded)
  → Outbox: payment.refunded { allRefunded, items, deliveryType }
  → Order: payment_status → refunded/partial_refund
  → Inventory: restore stock (return items to shelf)
  → Supplier: PO payment_status → refunded/partial_refund
```

### 5. Transactional Outbox Pattern
- Event được ghi vào `outbox_events` table trong **cùng transaction** với DB update
- Poller chạy mỗi **1000ms** (`setInterval`) đọc events chưa publish
- Publish qua RabbitMQ → đánh dấu `published_at`
- Đảm bảo **at-least-once delivery** + **atomicity**

## Event Payload Contract

### CRITICAL: items[] in payment.completed

Inventory Service **only deducts stock when `items[]` has data**. If `items = []`, the handler skips entirely -- no error, no deduction.

| Field | Type | Required | Source |
|-------|------|----------|--------|
| `items` | `Array<{batchId, quantity, productName}>` | YES | Frontend sends in request body |
| `deliveryType` | `'pickup'` or `'delivery'` | YES | Frontend sends from `order.deliveryType` |
| `totalPaidSoFar` | `number` | Computed | Backend calculates from `SUM(completed payments)` |
| `referenceType` | `'SaleOrder'` or `'PurchaseOrder'` | YES | Mapped from frontend `'Order'` / `'PurchaseOrder'` |

### items[] Storage

When a payment is created (pending or direct), `items` are stored as **JSONB** in the `payment.items` column.
When a pending payment is later approved (`status -> completed`), the backend reads `items` from DB to include in the event.

### Frontend Gotcha: ViewOrderPaymentsModal

- Order list view does NOT return `details[]` -- only headers
- If `ViewOrderPaymentsModal` submits payment without fetching details first, `items = []`
- FIX: Modal must call `getOrderById()` on mount to populate items
- Status: **FIXED** -- `loadOrderDetails()` added to ViewOrderPaymentsModal.jsx

## Known Issues / Gotchas

| # | Issue | Status | Note |
|---|-------|--------|------|
| 1 | Payment from Order view had empty items[] | FIXED | ViewOrderPaymentsModal now fetches order details on mount |
| 2 | Auth middleware missing | FIXED | All endpoints now use verifyToken |
| 3 | `referenceType` mapping | By Design | Frontend sends `'Order'`, route maps to `'SaleOrder'` via `toDbReferenceType()` |

## Environment Variables
```env
PORT=3007
DATABASE_URL=postgresql://...
RABBITMQ_URL=amqps://...
JWT_SECRET=your-secret
VNP_TMNCODE=your-vnpay-merchant-code
VNP_HASHSECRET=your-vnpay-hash-secret
VNP_URL=https://sandbox.vnpayment.vn
VNP_TEST_MODE=true
```
