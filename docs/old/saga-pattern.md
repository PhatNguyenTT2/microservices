# TÀI LIỆU KIẾN TRÚC: QUẢN LÝ GIAO DỊCH PHÂN TÁN (SAGA PATTERN)

**Domain:** Đặt hàng (Order) – Tồn kho (Inventory) – Thanh toán (Payment)
**Phiên bản:** 2.0 — Cập nhật theo kiến trúc thực tế
**Ngày cập nhật:** 2026-03-24

---

## 1. Tổng quan

Trong kiến trúc Microservices, mỗi service sở hữu một database riêng (database-per-service). Việc sử dụng Transaction cục bộ (ACID) không còn khả thi khi một thao tác trải dài qua nhiều services.

Tài liệu này quy định việc sử dụng **Saga Pattern** (Compensating Transactions) để đảm bảo tính **Nhất quán cuối (Eventual Consistency)** của dữ liệu toàn hệ thống.

### 1.1 Phạm vi áp dụng

Hệ thống hiện tại phục vụ **2 luồng giao dịch chính**:

| Luồng | Mô tả | Mức phức tạp |
|-------|--------|-------------|
| **POS Checkout** | Nhân viên bán hàng tại quầy → tạo order → thanh toán ngay | Đơn giản (Event-Driven) |
| **PO Receive** | Nhập hàng từ nhà cung cấp → tạo batch → nhập kho | Cross-service (Compensating) |
| **Online Ordering** _(tương lai)_ | Khách hàng đặt online → reserve → pay → confirm | Full Saga |

---

## 2. Các Microservices tham gia

### 2.1 Order Service (`order_db` — Port 3003)

Quản lý vòng đời đơn hàng bán.

| Trạng thái `status` | Mô tả |
|---------------------|--------|
| `draft` | Đơn hàng nháp, đang chọn sản phẩm |
| `completed` | Đã thanh toán thành công |
| `shipping` | Đang giao hàng |
| `delivered` | Đã giao thành công |
| `cancelled` | Đã hủy |
| `refunded` | Đã hoàn tiền |

| Trạng thái `payment_status` | Mô tả |
|-----------------------------|--------|
| `pending` | Chưa thanh toán |
| `partial` | Thanh toán một phần |
| `paid` | Đã thanh toán đủ |
| `failed` | Thanh toán thất bại |
| `refunded` | Đã hoàn tiền |

**Event subscriptions hiện tại:**
- `payment.completed` → cập nhật order `status = completed`, `payment_status = paid`
- `payment.failed` → log only (order giữ nguyên `draft`)

### 2.2 Inventory Service (`inventory_db` — Port 3006)

Quản lý tồn kho chi tiết (batch, location, movement).

**Các hành động hiện tại:**

| Hành động | Method | Mô tả |
|-----------|--------|--------|
| Nhập kho | `receiveStock()` | Tạo `inventory_item` + ghi `inventory_movement` (type: `in`) |
| Trừ kho | `deductStock()` | Giảm `quantity_on_shelf` + ghi movement (type: `out`) |
| Chuyển kệ | `moveStockToShelf()` | Di chuyển từ `on_hand` sang `on_shelf` + ghi movement (type: `transfer`) |

**Event subscriptions hiện tại:**
- `payment.completed` → `deductStock()` trừ `on_shelf` cho từng item trong order

**Lưu ý:** Cột `quantity_reserved` **đã tồn tại** trong bảng `inventory_item` nhưng chưa có logic `reserveStock()` / `releaseStock()`.

### 2.3 Payment Service (`payment_db` — Port 3007)

Quản lý thanh toán qua nhiều phương thức.

| Phương thức | Luồng |
|-------------|-------|
| `cash` / `card` / `bank_transfer` | Thanh toán trực tiếp → `completed` ngay → publish event |
| `vnpay` | Tạo URL → redirect → IPN webhook → publish event |

**Events publish:**
- `payment.completed` — khi thanh toán thành công
- `payment.failed` — khi VNPay trả về response code ≠ `00`

### 2.4 Message Broker

RabbitMQ — Exchange: `posmart.events` (topic, durable)

---

## 3. Luồng giao dịch hiện tại

### 3.1 POS Checkout (Happy Path)

Luồng bán hàng tại quầy — nhân viên thu ngân thao tác trực tiếp.

```
[POS Frontend] → POST /orders (draft) → [Order Service]
                                              ↓
[POS Frontend] → POST /payments (cash/card) → [Payment Service]
                                                    ↓
                                              publish(payment.completed)
                                                    ↓
                         ┌──────────────────────────┼──────────────────────────┐
                         ↓                                                     ↓
                  [Order Service]                                    [Inventory Service]
            status → completed                                  deductStock(on_shelf)
            payment_status → paid                               movement_type: out
```

### 3.2 PO Receive — Nhập hàng từ Purchase Order

Nhập hàng từ nhà cung cấp. Supplier Service gọi Inventory Service qua HTTP.

```
[Frontend] → POST /purchase-orders/:id/receive → [Supplier Service]
                                                       ↓
                               ┌───────────────────────┼────────────────────────┐
                               ↓                                                ↓
                    HTTP POST /api/batches                          HTTP POST /api/inventory/receive
                    [Inventory Service]                             [Inventory Service]
                    Tạo product_batch                               Tạo inventory_item
                                                                    Ghi inventory_movement
                               ↓
                    UPDATE po_detail.batch_id
                    UPDATE po.status = received
                    [Supplier Service DB — COMMIT]
```

---

## 4. Các kịch bản lỗi & Giao dịch bù trừ (Compensating Transactions)

### 4.1 POS — `deductStock` thất bại (hết hàng trên kệ)

**Hiện trạng:** Khi `payment.completed` event được gửi, Order Service cập nhật thành `completed`, nhưng Inventory Service `deductStock()` có thể fail nếu `on_shelf < quantity`. **Không có compensating** — dẫn đến mất đồng bộ.

**Giải pháp cần implement:**

```
payment.completed → Inventory deductStock() FAIL
                         ↓
              publish(inventory.deduct_failed)
                         ↓
              Order Service: revert status → cancelled
                                           payment_status → failed
```

### 4.2 PO Receive — HTTP call thất bại giữa chừng

**Hiện trạng:** `receivePO()` sử dụng HTTP đồng bộ gọi Inventory Service. Nếu batch tạo thành công nhưng `receiveStock` fail → batch mồ côi.

**Giải pháp đã áp dụng:**
- `receiveStock()` tự tìm default location nếu không có `locationId`
- Supplier Service transaction `ROLLBACK` local DB khi có lỗi

**Giải pháp cần bổ sung:**
- Thêm `DELETE /api/batches/:id` endpoint vào Inventory Service
- Trong `catch` block của `receivePO()`, gọi cleanup cho các batch đã tạo

### 4.3 VNPay — Thanh toán timeout (User bỏ ngỏ)

**Hiện trạng:** Chưa có xử lý timeout. Nếu user tạo payment VNPay → redirect → đóng tab → payment treo ở `pending` vĩnh viễn.

**Giải pháp cần implement:**
- Sử dụng **Delay Queue** (DLQ) trên RabbitMQ hoặc **Cronjob** quét transaction `pending` quá 15 phút
- Tự động publish `payment.timeout` → cập nhật payment `status = expired`

---

## 5. Nguyên tắc thiết kế BẮT BUỘC

### 5.1 Tính lũy đẳng (Idempotency)

Trong môi trường phân tán, message có thể bị gửi trùng lặp (at-least-once delivery).

**Yêu cầu:** Mỗi event handler phải có cơ chế chống trùng.

**Giải pháp:**
- Mỗi message có `message_id` duy nhất (hiện tại: `{eventType}-{timestamp}-{random}`)
- Thêm bảng `processed_events` tại mỗi service:

```sql
CREATE TABLE IF NOT EXISTS processed_events (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    event_id TEXT UNIQUE NOT NULL,
    event_type TEXT NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_processed_events_id ON processed_events(event_id);
```

- Trước khi xử lý event → check `event_id` đã tồn tại → skip nếu trùng

**Trạng thái:** ⚠️ Chưa implement — cần thêm vào `init.sql` của 3 services (Order, Inventory, Payment)

### 5.2 Không khóa chờ (Async Communication)

**Nguyên tắc:** Giao tiếp cross-service nên dùng event-driven (RabbitMQ), không dùng HTTP đồng bộ.

**Hiện trạng:**
- ✅ POS Checkout: Event-driven qua RabbitMQ
- ⚠️ PO Receive: HTTP đồng bộ (`axios.post` từ Supplier → Inventory) — chấp nhận được cho nội bộ backend, nhưng cần compensating transactions

**Lưu ý cho POS:** Do bán hàng tại quầy, frontend có thể dùng HTTP request-response trực tiếp (không cần WebSocket/polling). Event-driven chỉ áp dụng cho backend-to-backend communication.

### 5.3 Cô lập lỗi (Transactional Outbox)

**Nguyên tắc:** Việc publish event và commit DB phải đảm bảo nguyên tử (atomic). Nếu DB commit thành công → event **phải** được gửi.

**Giải pháp: Transactional Outbox Pattern**

```sql
CREATE TABLE IF NOT EXISTS outbox_events (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ
);
```

- **Trong transaction:** Insert event vào `outbox_events` (cùng COMMIT với data thay đổi)
- **Background poller:** Quét `outbox_events` WHERE `published_at IS NULL` → publish lên RabbitMQ → update `published_at`

**Trạng thái:** ⚠️ Chưa implement — hiện tại publish event **sau** DB commit (có risk mất event nếu server crash giữa 2 bước)

---

## 6. Luồng Online Ordering (Tương lai)

> Khi hệ thống mở rộng sang đặt hàng online, cần thêm các thành phần sau.

### 6.1 Thay đổi DB cần thiết

**Order Service:**
```sql
-- Thêm status cho online flow
ALTER TABLE sale_order DROP CONSTRAINT IF EXISTS sale_order_status_check;
ALTER TABLE sale_order ADD CONSTRAINT sale_order_status_check 
    CHECK (status IN ('draft', 'pending', 'reserved', 'completed', 'shipping', 'delivered', 'cancelled', 'refunded'));
```

**Inventory Service:** Cần thêm `reserveStock()` và `releaseStock()` methods sử dụng cột `quantity_reserved` đã có.

### 6.2 Luồng Full Saga

```
Client → POST /orders → Order Service: save PENDING → publish order.created
                                                           ↓
                                                    Inventory Service
                                                    reserveStock(quantity_reserved += qty)
                                                           ↓
                                              ┌── Đủ hàng ──┼── Thiếu hàng ──┐
                                              ↓                               ↓
                                    publish stock.reserved          publish stock.reservation_failed
                                              ↓                               ↓
                                    Order: RESERVED                 Order: CANCELLED (out of stock)
                                    Payment: tạo phiên
                                              ↓
                                 ┌── Success ──┼── Failed/Timeout ──┐
                                 ↓                                   ↓
                           payment.completed                   payment.failed / payment.timeout
                                 ↓                                   ↓
                      Order: PAID                           Order: CANCELLED
                      Inventory: confirmDeduct              Inventory: releaseStock
                      (reserved → sold)                     (quantity_reserved -= qty)
```

### 6.3 Events mới cần thiết

| Event | Publisher | Subscribers |
|-------|-----------|-------------|
| `order.created` | Order Service | Inventory Service |
| `stock.reserved` | Inventory Service | Order Service, Payment Service |
| `stock.reservation_failed` | Inventory Service | Order Service |
| `payment.timeout` | Cronjob / DLQ | Order Service, Inventory Service |

---

## 7. Debug & Monitoring

Khi debug lỗi luồng Saga:

1. **Không kiểm tra đơn lẻ một Database** — Saga trải dài qua nhiều DB
2. **Dùng Centralized Logging** — Tìm theo `orderId` hoặc `correlation_id` xuyên suốt các service
3. **Check `processed_events`** — Xác nhận event đã được xử lý hay chưa
4. **Check `outbox_events`** — Xác nhận event đã được publish hay bị kẹt