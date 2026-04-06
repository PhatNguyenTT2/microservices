# Báo cáo Kỹ thuật: Hệ thống Saga Choreography — 3 Service Core

## 1. Tổng quan Kiến trúc

Hệ thống Mini-Mart sử dụng **kiến trúc microservices** với 3 service lõi phối hợp qua **Saga Choreography** (event-driven, không có orchestrator trung tâm):

| Service | Port | Vai trò | DB |
|---------|------|---------|-----|
| **Order Service** | 3003 | Quản lý đơn hàng, trạng thái đơn | Shared Supabase PostgreSQL |
| **Payment Service** | 3007 | Xử lý thanh toán (Cash, Bank Transfer, VNPay) | Shared Supabase PostgreSQL |
| **Inventory Service** | 3006 | Quản lý tồn kho, xuất/nhập/reserve | Shared Supabase PostgreSQL |

### Hạ tầng giao tiếp

```mermaid
graph TB
    subgraph "Frontend (React)"
        FE["Admin Panel<br/>localhost:5173"]
    end

    subgraph "API Gateway (Nginx)"
        GW["gateway:8080"]
    end

    subgraph "Microservices"
        ORD["Order Service<br/>:3003"]
        PAY["Payment Service<br/>:3007"]
        INV["Inventory Service<br/>:3006"]
    end

    subgraph "Message Broker"
        RMQ["RabbitMQ<br/>CloudAMQP<br/>Exchange: posmart.events (topic)"]
    end

    subgraph "Database"
        DB["Supabase PostgreSQL<br/>(Shared DB)"]
    end

    FE --> GW
    GW --> ORD & PAY & INV
    ORD <--> RMQ
    PAY <--> RMQ
    INV <--> RMQ
    ORD --> DB
    PAY --> DB
    INV --> DB

    style RMQ fill:#ff6b35,color:#fff
    style DB fill:#3ecf8e,color:#fff
    style GW fill:#4a90d9,color:#fff
```

> [!IMPORTANT]
> **Shared Database**: Tất cả services dùng chung 1 Supabase PostgreSQL. Đây là anti-pattern trong microservices nhưng được chọn vì đây là hệ thống học thuật. Để tránh xung đột, hệ thống sử dụng **`service_name` isolation** trên các bảng `outbox_events` và `processed_events`.

---

## 2. Transactional Outbox Pattern

Mỗi service sử dụng **Transactional Outbox** để đảm bảo **exactly-once delivery** giữa database write và event publish:

```mermaid
sequenceDiagram
    participant App as Service Logic
    participant DB as PostgreSQL
    participant Poller as Outbox Poller
    participant MQ as RabbitMQ

    Note over App,DB: Cùng 1 transaction
    App->>DB: INSERT/UPDATE business data
    App->>DB: INSERT outbox_events (service_name='xxx')
    App->>DB: COMMIT

    Note over Poller: Mỗi 1 giây
    loop Polling (1s interval)
        Poller->>DB: SELECT FROM outbox_events<br/>WHERE published_at IS NULL<br/>AND service_name = 'xxx'<br/>FOR UPDATE SKIP LOCKED
        Poller->>MQ: eventBus.publish(event_type, payload)
        Poller->>DB: UPDATE SET published_at = NOW()
    end
```

### Idempotency — Bảng `processed_events`

Mỗi service ghi lại event đã xử lý vào `processed_events` với **composite unique constraint** `(event_id, service_name)`:

```sql
-- Cho phép Order và Inventory cùng xử lý event "payment.completed-xxx" mà KHÔNG xung đột
UNIQUE(event_id, service_name)
```

> [!WARNING]
> **Bug đã fix**: Trước đây `UNIQUE(event_id)` khiến service nào INSERT trước thì "thắng", service còn lại bị skip duplicate. Bây giờ mỗi service có namespace riêng.

---

## 3. Order Status Machine

```mermaid
stateDiagram-v2
    [*] --> draft : Tạo đơn hàng

    draft --> shipping : payment.completed<br/>(delivery order)
    draft --> delivered : payment.completed<br/>(pickup/POS order)
    draft --> cancelled : payment.failed / timeout

    shipping --> delivered : Shipper xác nhận giao
    shipping --> cancelled : Hủy khi đang giao

    delivered --> refunded : Hoàn tiền toàn bộ

    cancelled --> [*]
    refunded --> [*]
```

**Payment Status**: `pending` → `paid` / `failed` / `partial_refund` / `refunded`

---

## 4. Luồng nghiệp vụ chi tiết

### 4.1. Bán hàng tại quầy (POS / Pickup)

Luồng **đồng bộ**, khách nhận hàng và thanh toán ngay tại quầy.

```mermaid
sequenceDiagram
    actor User as Thu ngân
    participant FE as Frontend
    participant ORD as Order Service
    participant PAY as Payment Service
    participant MQ as RabbitMQ
    participant INV as Inventory Service

    Note over User,INV: Bước 1 — Tạo đơn hàng
    User->>FE: Tạo đơn POS
    FE->>ORD: POST /api/orders<br/>{delivery_type: "pickup", items: [...]}
    ORD-->>FE: 201 {status: "draft", payment_status: "pending"}

    Note over User,INV: Bước 2 — Thanh toán trực tiếp
    User->>FE: Nhấn "Pay & Complete"
    FE->>PAY: POST /api/payments/direct<br/>{referenceType: "Order", amount, method: "cash"}
    PAY->>PAY: INSERT payment (status=completed)
    PAY->>PAY: INSERT outbox_events (payment.completed)
    PAY-->>FE: 201 Payment completed

    Note over PAY,MQ: Outbox Poller (1s)
    PAY->>MQ: publish payment.completed<br/>{orderId, storeId, deliveryType: "pickup", items}

    par Order nhận event
        MQ->>ORD: payment.completed
        ORD->>ORD: INSERT processed_events (order-service)
        ORD->>ORD: updateOrderStatus(draft → delivered, paid)
        Note over ORD: Pickup: status = delivered ngay
    and Inventory nhận event
        MQ->>INV: payment.completed
        INV->>INV: INSERT processed_events (inventory-service)
        INV->>INV: deductStock(on_shelf -= qty)
        Note over INV: Trừ trực tiếp từ kệ trưng bày
    end
```

**Kết quả cuối cùng:**
- Order: `status = delivered`, `payment_status = paid`
- Inventory: `on_shelf -= quantity` (đã trừ), `reserved` không thay đổi
- Movement: ghi nhận `out` — xuất kho bán hàng

---

### 4.2. Bán hàng Online (Delivery) — Two-Phase

Luồng **bất đồng bộ**, có 2 pha: tạm giữ kho khi giao và xác nhận khi khách nhận.

```mermaid
sequenceDiagram
    actor Customer as Khách hàng
    participant FE as Frontend
    participant ORD as Order Service
    participant PAY as Payment Service
    participant MQ as RabbitMQ
    participant INV as Inventory Service

    Note over Customer,INV: Bước 1 — Đặt hàng
    Customer->>FE: Đặt hàng online
    FE->>ORD: POST /api/orders<br/>{delivery_type: "delivery", items: [...]}
    ORD-->>FE: 201 {status: "draft"}

    Note over Customer,INV: Bước 2 — Thanh toán (VNPay/Cash)
    FE->>PAY: POST /api/payments/direct<br/>{deliveryType: "delivery"}
    PAY->>PAY: INSERT payment (completed)
    PAY->>PAY: INSERT outbox_events (payment.completed)

    Note over PAY,MQ: Outbox Poller
    PAY->>MQ: publish payment.completed<br/>{deliveryType: "delivery", items}

    par Order nhận event
        MQ->>ORD: payment.completed
        ORD->>ORD: draft → shipping, paid
        ORD->>ORD: INSERT outbox_events (order.shipping)
        Note over ORD: Phase 1: Đóng gói, xuất phát
    and Inventory nhận payment.completed
        MQ->>INV: payment.completed (delivery)
        INV->>INV: SKIP — đợi order.shipping
        Note over INV: Chưa trừ kho, đợi xác nhận shipping
    end

    Note over ORD,MQ: Outbox Poller
    ORD->>MQ: publish order.shipping<br/>{orderId, storeId, items, deliveryType}

    MQ->>INV: order.shipping
    INV->>INV: reserveStock(on_shelf -= qty, reserved += qty)
    Note over INV: Phase 1: Lấy hàng khỏi kệ, đánh dấu tạm giữ

    Note over Customer,INV: Bước 5 — Khách nhận hàng
    FE->>ORD: PUT /api/orders/:id {status: "delivered"}
    ORD->>ORD: shipping → delivered
    ORD->>ORD: INSERT outbox_events (order.delivered)

    Note over ORD,MQ: Outbox Poller
    ORD->>MQ: publish order.delivered<br/>{deliveryType: "delivery"}

    MQ->>INV: order.delivered
    INV->>INV: confirmDeduct(reserved -= qty)
    Note over INV: Phase 2: Giải phóng reserved — hàng đã bán
```

**Inventory thay đổi theo 2 pha:**

| Pha | Event | on_shelf | reserved | Ý nghĩa |
|-----|-------|----------|----------|---------|
| Phase 1 | `order.shipping` | −qty | +qty | Hàng rời kệ, đang giao |
| Phase 2 | `order.delivered` | — | −qty | Xác nhận đã bán xong |

---

### 4.3. Hủy đơn hàng đang giao

```mermaid
sequenceDiagram
    participant FE as Frontend
    participant ORD as Order Service
    participant MQ as RabbitMQ
    participant INV as Inventory Service

    FE->>ORD: PUT /api/orders/:id {status: "cancelled"}
    ORD->>ORD: shipping → cancelled
    ORD->>ORD: INSERT outbox_events (order.cancelled)

    ORD->>MQ: publish order.cancelled<br/>{deliveryType: "delivery", items}

    MQ->>INV: order.cancelled
    INV->>INV: releaseStock(reserved -= qty, on_shelf += qty)
    Note over INV: Hoàn trả: hàng quay lại kệ
```

**Inventory rollback:**
- `reserved -= qty` (giải phóng hàng tạm giữ)
- `on_shelf += qty` (trả lại kệ trưng bày)
- Movement type: `release`

---

### 4.4. Thanh toán VNPay (Online Payment Gateway)

```mermaid
sequenceDiagram
    actor Customer as Khách
    participant FE as Frontend
    participant PAY as Payment Service
    participant VNPAY as VNPay Gateway
    participant MQ as RabbitMQ
    participant ORD as Order Service
    participant INV as Inventory Service

    Customer->>FE: Chọn thanh toán VNPay
    FE->>PAY: POST /api/payments/vnpay/create-url
    PAY->>PAY: Tạo payment (pending) + VNPay params
    PAY-->>FE: {paymentUrl: "https://sandbox.vnpay..."}

    FE->>Customer: Redirect đến VNPay
    Customer->>VNPAY: Nhập thông tin thẻ

    alt Thanh toán thành công
        VNPAY->>PAY: IPN Webhook (vnp_ResponseCode=00)
        PAY->>PAY: payment: pending → completed
        PAY->>PAY: INSERT outbox_events (payment.completed)
        PAY->>MQ: publish payment.completed
        MQ->>ORD: → draft → shipping/delivered
        MQ->>INV: → reserveStock / deductStock
    else Thanh toán thất bại
        VNPAY->>PAY: IPN (vnp_ResponseCode≠00)
        PAY->>PAY: payment: pending → failed
        PAY->>PAY: INSERT outbox_events (payment.failed)
        PAY->>MQ: publish payment.failed
        MQ->>ORD: → draft → cancelled
    else Timeout (15 phút)
        Note over PAY: Timeout Scanner (5 phút/lần)
        PAY->>PAY: Scan VNPay pending > 15 min
        PAY->>PAY: payment: pending → expired
        PAY->>MQ: publish payment.timeout
        MQ->>ORD: → draft → cancelled
    end
```

---

### 4.5. Hoàn tiền (Refund)

```mermaid
sequenceDiagram
    participant FE as Frontend
    participant PAY as Payment Service
    participant MQ as RabbitMQ
    participant ORD as Order Service

    FE->>PAY: POST /api/payments/:id/refund
    PAY->>PAY: payment: completed → refunded
    PAY->>PAY: Check if ALL payments refunded
    PAY->>PAY: INSERT outbox_events (payment.refunded)

    PAY->>MQ: publish payment.refunded<br/>{allRefunded: true/false}

    MQ->>ORD: payment.refunded
    alt allRefunded = true
        ORD->>ORD: payment_status → refunded
    else allRefunded = false
        ORD->>ORD: payment_status → partial_refund
    end

    Note over FE,ORD: ⚠ Hoàn hàng tồn kho<br/>phải thao tác thủ công<br/>trên trang Inventory
```

> [!NOTE]
> **Refund chỉ xử lý dòng tiền.** Hoàn trả hàng vào kho (inventory return) phải thao tác riêng trên trang Inventory — đây là quyết định thiết kế để tách biệt nghiệp vụ tài chính và logistics.

---

## 5. Saga Compensation (Xử lý lỗi)

```mermaid
sequenceDiagram
    participant PAY as Payment Service
    participant MQ as RabbitMQ
    participant ORD as Order Service
    participant INV as Inventory Service

    Note over PAY,INV: Kịch bản: Trừ kho thất bại

    PAY->>MQ: payment.completed
    MQ->>ORD: → draft → shipping
    MQ->>INV: → deductStock/reserveStock

    INV--xINV: ❌ Hết hàng! (on_shelf < qty)
    INV->>MQ: publish inventory.deduct_failed<br/>{orderId, reason}

    MQ->>ORD: inventory.deduct_failed
    ORD->>ORD: shipping/delivered → cancelled, failed
    Note over ORD: Compensation: Hoàn trạng thái đơn
```

---

## 6. Event Catalog

### Events do **Payment Service** publish

| Event | Trigger | Payload | Consumers |
|-------|---------|---------|-----------|
| `payment.completed` | Payment thành công | `{paymentId, orderId, storeId, referenceType, amount, method, items, deliveryType, totalPaidSoFar}` | Order, Inventory |
| `payment.failed` | VNPay thất bại | `{paymentId, orderId, storeId, reason}` | Order |
| `payment.timeout` | VNPay hết hạn (15m) | `{paymentId, orderId, storeId, reason}` | Order |
| `payment.refunded` | Admin hoàn tiền | `{paymentId, orderId, storeId, referenceType, amount, allRefunded}` | Order |

### Events do **Order Service** publish

| Event | Trigger | Payload | Consumers |
|-------|---------|---------|-----------|
| `order.shipping` | `draft → shipping` (delivery) | `{orderId, storeId, items, deliveryType}` | Inventory |
| `order.delivered` | `shipping → delivered` | `{orderId, storeId, items, deliveryType}` | Inventory |
| `order.cancelled` | `shipping → cancelled` | `{orderId, storeId, items, deliveryType}` | Inventory |

### Events do **Inventory Service** publish

| Event | Trigger | Payload | Consumers |
|-------|---------|---------|-----------|
| `inventory.deduct_failed` | Stock operation lỗi | `{orderId, storeId, reason}` | Order |

---

## 7. Shared-DB Isolation Pattern

Vì tất cả services dùng chung 1 database, 2 bảng hệ thống cần cột `service_name` để cách ly:

### `outbox_events`
```sql
CREATE TABLE outbox_events (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    service_name TEXT,         -- 🔑 Filter: mỗi poller chỉ đọc event của mình
    created_at TIMESTAMPTZ DEFAULT NOW(),
    published_at TIMESTAMPTZ   -- NULL = chưa publish
);
```

**Poller query**: `WHERE published_at IS NULL AND service_name = $1`

### `processed_events`
```sql
CREATE TABLE processed_events (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    event_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    service_name TEXT NOT NULL, -- 🔑 Mỗi service track riêng
    processed_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(event_id, service_name)  -- Cho phép cùng 1 event xử lý ở nhiều service
);
```

---

## 8. Tổng kết: Bảng so sánh Pickup vs Delivery

| Bước | Pickup (POS) | Delivery (Online) |
|------|-------------|-------------------|
| **Tạo đơn** | draft | draft |
| **Thanh toán** | payment.completed → **delivered** | payment.completed → **shipping** |
| **Inventory @ payment** | `deductStock` (on_shelf -= qty) | **skip** (đợi shipping) |
| **Inventory @ shipping** | — | `reserveStock` (on_shelf → reserved) |
| **Giao hàng** | — | shipping → **delivered** |
| **Inventory @ delivered** | **skip** (đã trừ) | `confirmDeduct` (reserved -= qty) |
| **Hủy đơn** | Không cho hủy (đã delivered) | `releaseStock` (reserved → on_shelf) |

```mermaid
graph LR
    subgraph "Pickup Flow"
        P1["draft"] -->|"payment.completed"| P2["delivered"]
        P2 -.->|"Inventory"| P3["on_shelf -= qty"]
    end

    subgraph "Delivery Flow"
        D1["draft"] -->|"payment.completed"| D2["shipping"]
        D2 -.->|"Phase 1"| D3["on_shelf -= qty<br/>reserved += qty"]
        D2 -->|"Giao thành công"| D4["delivered"]
        D4 -.->|"Phase 2"| D5["reserved -= qty"]
    end

    style P2 fill:#10b981,color:#fff
    style D2 fill:#f59e0b,color:#fff
    style D4 fill:#10b981,color:#fff
```
