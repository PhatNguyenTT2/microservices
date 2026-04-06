# Service 6: Inventory

> **Port:** `3006` · **DB:** `inventory_db` (Supabase) · **Message Bus:** RabbitMQ  
> **⚡ Saga Participant** — Core participant xử lý stock reserve/deduct/release

## Tổng Quan

Service quản lý tồn kho, lô hàng (Batches), kho bãi (Warehouses), và xuất kho (Stock Out). Là **trung tâm Saga** cho stock operations — nhận events từ Payment và Order để tự động reserve/deduct/release stock.

## Kiến Trúc

```
inventory/src/
├── db/init.sql                         # Schema + migrations + views
├── index.js                            # Entrypoint + Event subscriptions (heavy)
├── app.js                              # Express middleware
├── routes/
│   ├── batch.routes.js                 # CRUD lô hàng
│   ├── inventory.routes.js             # Tồn kho + movements
│   ├── warehouse.routes.js             # Kho bãi + locations
│   ├── stock-out.routes.js             # Xuất kho
│   └── health.routes.js
├── services/
│   ├── inventory.service.js            # Stock logic (deduct, reserve, release)
│   ├── stock-out.service.js            # Stock out orders
│   └── warehouse.service.js            # Warehouse/location management
└── repositories/
    ├── batch.repository.js
    ├── inventory.repository.js
    ├── warehouse.repository.js
    └── stock-out.repository.js
```

## Database Schema

| Table | Mô tả | Multi-Tenancy |
|-------|--------|:---:|
| `product_batch` | Lô hàng (cost_price, unit_price, expiry, quantity) | ✅ `store_id` |
| `warehouse_block` | Khu vực kho (warehouse / store_shelf) với grid layout | ✅ `store_id` |
| `location` | Vị trí cụ thể trong kho (row-col) | via FK |
| `inventory_item` | Tồn kho chi tiết (on_hand, on_shelf, reserved) | via batch→store |
| `inventory_movement` | Lịch sử di chuyển hàng (in, out, adjustment, transfer, reserve, release) | via FK |
| `stock_out_order` | Phiếu xuất kho | ✅ `store_id` |
| `stock_out_detail` | Chi tiết phiếu xuất kho | via FK |
| `processed_events` | Saga idempotency | — |
| `outbox_events` | Transactional Outbox | — |

### View
| View | Mô tả |
|------|-------|
| `v_product_inventory` | Tổng hợp tồn kho theo `store_id + product_id` (total_on_hand, total_on_shelf, total_reserved, total_available) |

### Stock Quantities
```
on_hand    — Tổng tồn kho (trong kho)
on_shelf   — Trên kệ (đang bày bán)
reserved   — Đã giữ cho đơn delivery (chưa giao)
available  = on_hand + on_shelf - reserved
```

### Movement Types
| Type | Mô tả |
|------|-------|
| `in` | Nhập kho (PO received, stock return) |
| `out` | Xuất kho (sale, damage, transfer) |
| `adjustment` | Điều chỉnh tồn kho (kiểm kê) |
| `transfer` | Chuyển vị trí (location A → B) |
| `reserve` | Giữ stock cho đơn delivery |
| `release` | Hủy giữ stock (đơn cancelled) |

## API Endpoints

### Batches (Lô hàng)
| Method | Endpoint | Auth | Mô tả |
|--------|----------|:----:|-------|
| `GET` | `/api/batches` | 🔑 | Danh sách lô hàng |
| `GET` | `/api/batches/:id` | 🔑 | Chi tiết lô |
| `POST` | `/api/batches` | 🔑 | Tạo lô mới |
| `PUT` | `/api/batches/:id` | 🔑 | Cập nhật lô |

### Inventory (Tồn kho)
| Method | Endpoint | Auth | Mô tả |
|--------|----------|:----:|-------|
| `GET` | `/api/inventory` | 🔑 | Tồn kho tổng hợp |
| `GET` | `/api/inventory/summary` | 🔑 | Tổng hợp theo sản phẩm |
| `GET` | `/api/inventory/movements` | 🔑 | Lịch sử di chuyển |
| `POST` | `/api/inventory/stock-in` | 🔑 | Nhập kho thủ công |
| `POST` | `/api/inventory/stock-out` | 🔑 | Xuất kho thủ công |
| `POST` | `/api/inventory/adjust` | 🔑 | Điều chỉnh tồn kho |
| `POST` | `/api/inventory/transfer` | 🔑 | Chuyển vị trí |
| `POST` | `/api/inventory/move-to-shelf` | 🔑 | Chuyển từ kho lên kệ |

### Warehouses (Kho bãi)
| Method | Endpoint | Auth | Mô tả |
|--------|----------|:----:|-------|
| `GET` | `/api/warehouses` | 🔑 | Danh sách khu vực kho |
| `GET` | `/api/warehouses/:id` | 🔑 | Chi tiết kho + locations |
| `POST` | `/api/warehouses` | 🔑 | Tạo khu vực kho (grid layout) |
| `PUT` | `/api/warehouses/:id` | 🔑 | Cập nhật kho |
| `DELETE` | `/api/warehouses/:id` | 🔑 | Xóa kho |
| `GET` | `/api/warehouses/:id/map` | 🔑 | Bản đồ kho (visual grid) |

### Stock Out (Xuất kho)
| Method | Endpoint | Auth | Mô tả |
|--------|----------|:----:|-------|
| `GET` | `/api/stock-out-orders` | 🔑 | Danh sách phiếu xuất kho |
| `POST` | `/api/stock-out-orders` | 🔑 | Tạo phiếu xuất kho |
| `PATCH` | `/api/stock-out-orders/:id/complete` | 🔑 | Hoàn thành xuất kho |
| `PATCH` | `/api/stock-out-orders/:id/cancel` | 🔑 | Hủy phiếu xuất kho |

## Event Subscriptions (Saga)

| Event | Source | Handler |
|-------|--------|---------|
| `payment.completed` | Payment Service | **Pickup:** Deduct stock trực tiếp (`on_shelf -= qty`). **Delivery:** Reserve stock (`reserved += qty`) |
| `order.delivered` | Order Service | Confirm reserved stock → deduct (`reserved -= qty, on_shelf -= qty`) |
| `order.cancelled` | Order Service | Release reserved stock (`reserved -= qty`) |
| `payment.refunded` | Payment Service | Restore stock (return items to `on_shelf`) |

## Event Publishing (Outbox)

| Event | Trigger | Data |
|-------|---------|------|
| `stock.reserved` | Reserve thành công | `{ orderId, storeId }` |
| `stock.reservation_failed` | Reserve thất bại (không đủ stock) | `{ orderId, storeId, reason }` |
| `inventory.deduct_failed` | Deduct thất bại | `{ orderId, storeId, reason }` |
| `inventory.updated` | Bất kỳ stock change | `{ storeId }` → triggers Statistics cache invalidation |

## Logic Nghiệp Vụ

### 1. Pickup Flow (Immediate Deduction)
```
payment.completed (deliveryType=pickup)
  → Mỗi item: deductStock(storeId, batchId, locationId, qty)
    → inventory_item.quantity_on_shelf -= qty
    → Ghi inventory_movement(type=out, reason=pos_sale_order_X)
```

### 2. Delivery Flow (Reserve → Confirm)
```
payment.completed (deliveryType=delivery)
  → reserveStock(storeId, items) → reserved += qty
  → Publish stock.reserved → Order: reserved

Admin click "Delivered":
  → order.delivered event → confirmReserved → deduct actual stock
```

### 3. Warehouse Grid Layout
- Mỗi warehouse block có grid (`rows × cols`)
- `column_gaps` — Mảng cột bị trống (lối đi)
- Frontend render visual warehouse map

### 4. Cross-Service Communication
- Inventory calls **Catalog Service** (`CATALOG_SERVICE_URL`) to get product info during stock-in

## Event Handler Behavior Details

### payment.completed Handler

```
Input: { items, deliveryType, orderId, storeId }

Guard: if items is empty array [] --> handler SKIPS (no error logged, no deduction)

Pickup (deliveryType === 'pickup'):
  For each item:
    deductStock(storeId, batchId, locationId, qty)
    inventory_item.quantity_on_shelf -= qty
    Create inventory_movement(type='out', reason='pos_sale_order_X')
  Publish: inventory.updated

Delivery (deliveryType === 'delivery'):
  reserveStock(storeId, items)
    inventory_item.reserved += qty
  Publish: stock.reserved --> Order receives, sets status='reserved'
  On failure: stock.reservation_failed --> Order sets status='cancelled'
```

### order.delivered Handler
```
Confirms reserved stock --> actual deduction
  reserved -= qty
  on_shelf -= qty (or on_hand depending on location)
```

### order.cancelled Handler
```
Releases reserved stock
  reserved -= qty
```

### payment.refunded Handler
```
Restores stock to shelf
  on_shelf += qty
  Create inventory_movement(type='in', reason='refund_order_X')
```

## Known Issues / Gotchas

| # | Issue | Status | Note |
|---|-------|--------|------|
| 1 | Empty `items[]` causes silent skip | By Design | Payment must include items for deduction to occur |
| 2 | Stock-out workflow is manual | By Design | Uses dedicated `/api/stock-out-orders` (not order saga) |
| 3 | `available = on_hand + on_shelf - reserved` | By Design | Negative available means overcommitted stock |

## Environment Variables
```env
PORT=3006
DATABASE_URL=postgresql://...
RABBITMQ_URL=amqps://...
JWT_SECRET=your-secret
CATALOG_SERVICE_URL=http://catalog:3002
```
