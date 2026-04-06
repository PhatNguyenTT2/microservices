# Service 5: Supplier & Purchase Orders

> **Port:** `3005` · **DB:** `supplier_db` (Supabase) · **Message Bus:** RabbitMQ  
> **⚡ Saga Participant** — Listen `payment.completed/refunded` cho PO payment sync

## Tổng Quan

Service quản lý nhà cung cấp (Suppliers) và đơn đặt hàng nhập (Purchase Orders / PO). Tham gia Saga để tự động cập nhật `payment_status` khi nhận event từ Payment Service.

## Kiến Trúc

```
supplier/src/
├── db/init.sql                         # Schema + seed suppliers
├── index.js                            # Entrypoint + Event subscriptions
├── app.js                              # Express middleware
├── routes/
│   ├── supplier.routes.js              # CRUD suppliers
│   ├── purchase-order.routes.js        # CRUD purchase orders
│   └── health.routes.js
├── services/
│   ├── supplier.service.js
│   └── purchase-order.service.js       # PO logic + inventory coordination
└── repositories/
    ├── supplier.repository.js
    ├── purchase-order.repository.js
    └── purchase-order-detail.repository.js
```

## Database Schema

| Table | Mô tả | Multi-Tenancy |
|-------|--------|:---:|
| `supplier` | Nhà cung cấp (company, payment_terms, credit_limit, debt) | ❌ Chain-wide |
| `purchase_order` | Đơn nhập hàng (status, payment_status, shipping_fee) | ✅ `store_id` |
| `purchase_order_detail` | Chi tiết PO (product_id, batch_id, quantity, cost_price) | via FK |
| `processed_events` | Saga idempotency | — |
| `outbox_events` | Transactional Outbox | — |

### PO Status Machine
```
draft → approved → received → (end)
  ↓        ↓
  └────────┴────→ cancelled
```

### Payment Status
`unpaid` → `partial` → `paid` → `partial_refund` → `refunded`

### Payment Terms
| Code | Mô tả |
|------|-------|
| `cod` | Thanh toán khi nhận hàng |
| `net15` | Công nợ 15 ngày |
| `net30` | Công nợ 30 ngày |
| `net60` | Công nợ 60 ngày |
| `net90` | Công nợ 90 ngày |

## API Endpoints

### Suppliers
| Method | Endpoint | Auth | Mô tả |
|--------|----------|:----:|-------|
| `GET` | `/api/suppliers` | 🔑 | Danh sách nhà cung cấp |
| `GET` | `/api/suppliers/:id` | 🔑 | Chi tiết NCC |
| `POST` | `/api/suppliers` | 🔑 | Tạo NCC mới |
| `PUT` | `/api/suppliers/:id` | 🔑 | Cập nhật NCC |
| `DELETE` | `/api/suppliers/:id` | 🔑 | Xóa NCC |

### Purchase Orders
| Method | Endpoint | Auth | Mô tả |
|--------|----------|:----:|-------|
| `GET` | `/api/purchase-orders` | 🔑 | Danh sách PO |
| `GET` | `/api/purchase-orders/:id` | 🔑 | Chi tiết PO (with details) |
| `POST` | `/api/purchase-orders` | 🔑 | Tạo PO mới (draft) |
| `PUT` | `/api/purchase-orders/:id` | 🔑 | Cập nhật PO |
| `PATCH` | `/api/purchase-orders/:id/status` | 🔑 | Đổi trạng thái PO |
| `DELETE` | `/api/purchase-orders/:id` | 🔑 | Xóa PO (draft only) |

## Event Subscriptions

| Event | Source | Handler |
|-------|--------|---------|
| `payment.completed` | Payment Service | Cập nhật PO `payment_status` → `paid` hoặc `partial` (dựa vào `totalPaidSoFar >= poTotal`) |
| `payment.refunded` | Payment Service | Cập nhật PO `payment_status` → `refunded` hoặc `partial_refund` |

> **Filter:** Chỉ xử lý events có `referenceType === 'PurchaseOrder'`

## Logic Nghiệp Vụ

### 1. PO → Inventory Flow
```
Tạo PO (draft) → Approve → Receive
  → Nhập hàng: Gọi Inventory Service API tạo batches + stock in
  → Update supplier debt (current_debt += total_price)
```

### 2. Supplier Debt Management
- `credit_limit` — Hạn mức công nợ
- `current_debt` — Dư nợ hiện tại
- Khi thanh toán (payment.completed) → giảm `current_debt`

## Seed Data
- 15 Vietnamese suppliers (Vinamilk, Masan, Acecook, Nestle, TH True Milk...)

## PO Payment vs Order Payment Flow

| Aspect | Sale Order (Order Service) | Purchase Order (Supplier Service) |
|--------|--------------------------|----------------------------------|
| Direction | Customer pays us | We pay supplier |
| Payment triggers | Inventory deduction (pickup) or reservation (delivery) | PO `payment_status` update only |
| Inventory impact | YES -- deduct/reserve stock via saga | NO -- stock-in happens at PO receive |
| Event filter | `referenceType === 'SaleOrder'` | `referenceType === 'PurchaseOrder'` |
| Debt tracking | N/A | Supplier `current_debt` updated |

### Event Filter

Supplier Service **only processes** events where `referenceType === 'PurchaseOrder'`.
Events with `referenceType === 'SaleOrder'` are silently skipped.

### Debt Management Flow
```
PO approved -> PO received (stock-in)
  -> supplier.current_debt += po.total_price

payment.completed (for PO)
  -> supplier.current_debt -= payment.amount
  -> PO payment_status = 'paid' or 'partial'

payment.refunded (for PO)
  -> supplier.current_debt += refund.amount
  -> PO payment_status = 'refunded' or 'partial_refund'
```

## Environment Variables
```env
PORT=3005
DATABASE_URL=postgresql://...
RABBITMQ_URL=amqps://...
JWT_SECRET=your-secret
```
