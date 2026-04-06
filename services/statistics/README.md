# Service 9: Statistics & Analytics

> **Port:** `3009` · **Cache:** Redis Cloud · **Message Bus:** RabbitMQ  
> **📊 Aggregation Service** — Không có DB riêng, gọi API các service khác

## Tổng Quan

Service tổng hợp thống kê (Dashboard, Sales, Purchases, Profit, Inventory, Employee/Customer reports). **Không có database riêng** — gọi API nội bộ các service khác để lấy dữ liệu thô, tính toán, và cache kết quả trong **Redis**.

## Kiến Trúc

```
statistics/src/
├── index.js                       # Entrypoint + Event subscriptions (cache invalidation)
├── app.js                         # Express middleware
├── routes/
│   ├── statistics.routes.js       # All report endpoints
│   └── health.routes.js
├── services/
│   └── statistics.service.js      # Aggregation logic
├── clients/
│   ├── order.client.js            # HTTP client → Order Service
│   ├── catalog.client.js          # HTTP client → Catalog Service
│   └── auth.client.js             # HTTP client → Auth Service
├── cache/
│   └── redis.js                   # Redis client + invalidation
└── utils/
```

## API Endpoints

| Method | Endpoint | Auth | Mô tả |
|--------|----------|:----:|-------|
| `GET` | `/api/statistics/dashboard` | 🔑 | Dashboard overview (period comparison) |
| `GET` | `/api/statistics/sales` | 🔑 | Báo cáo doanh số theo sản phẩm |
| `GET` | `/api/statistics/purchases` | 🔑 | Báo cáo mua hàng theo sản phẩm |
| `GET` | `/api/statistics/profit` | 🔑 | Phân tích lợi nhuận (revenue vs costs) |
| `GET` | `/api/statistics/inventory` | 🔑 | Báo cáo tồn kho |
| `GET` | `/api/statistics/employee-sales` | 🔑 | Doanh số theo nhân viên |
| `GET` | `/api/statistics/customer-sales` | 🔑 | Doanh số theo khách hàng |

### Query Parameters
| Param | Mô tả |
|-------|-------|
| `period` | `day`, `week`, `month`, `year` |
| `from`, `to` | Date range filter |
| `storeId` | Filter theo cửa hàng |

## Event Subscriptions (Cache Invalidation)

| Event | Source | Action |
|-------|--------|--------|
| `order.created` | Order Service | Invalidate `stats:dashboard:*`, `stats:sales:*` |
| `payment.completed` | Payment Service | Invalidate `stats:dashboard:*`, `stats:sales:*` |
| `inventory.updated` | Inventory Service | Invalidate `stats:inventory:*` |

## Logic Nghiệp Vụ

### 1. Dashboard Overview
```
GET /api/statistics/dashboard?period=month
  → Gọi Order Service: lấy tất cả orders trong period
  → Gọi Catalog Service: lấy product names
  → Tính toán:
    ├── Tổng doanh thu (revenue)
    ├── Số đơn hàng (order count)
    ├── Giá trị trung bình đơn hàng (AOV)
    ├── So sánh với period trước (% change)
    └── Top products
  → Cache kết quả trong Redis
```

### 2. Profit Analysis
```
GET /api/statistics/profit
  → Revenue = SUM(sale_order.total_amount WHERE status=delivered)
  → Cost = SUM(inventory: cost_price × quantity_sold)
  → Profit = Revenue - Cost
  → Margin = Profit / Revenue × 100
```

### 3. Cross-Service HTTP Calls
| Service | URL | Data |
|---------|-----|------|
| Order | `http://order:3003` | Orders, Sales totals |
| Catalog | `http://catalog:3002` | Product names, categories |
| Auth | `http://auth:3001` | Employee names, Customer names |
| Inventory | `http://inventory:3006` | Stock levels, batches |
| Supplier | `http://supplier:3005` | Purchase order costs |

### 4. Redis Caching Strategy
- **Pattern:** `stats:{report_type}:{period}:{storeId}`
- **TTL:** Based on period (day=5m, week=15m, month=1h)
- **Invalidation:** Event-driven via RabbitMQ (no stale data)
- **Wildcard invalidation:** `stats:dashboard:*` clears all dashboard variants

## Architecture Notes

### No Database -- Pure Aggregation

Statistics Service has **no database of its own**. It:
1. Receives HTTP requests for reports
2. Calls other services' APIs to fetch raw data
3. Computes aggregations (revenue, profit, AOV, etc.)
4. Caches results in Redis with event-driven invalidation

### Auth Token Forwarding

When calling internal services, Statistics forwards the original JWT token from the request.
This ensures multi-tenancy (storeId) is respected at every service boundary.

```
Client -> Statistics -> Order Service (with same JWT)
                     -> Catalog Service (with same JWT)
                     -> Auth Service (with same JWT)
```

### Data Freshness

| Trigger | Staleness |
|---------|-----------|
| Event received (order.created, payment.completed) | 0s (immediate invalidation) |
| TTL expiry | 5m (day) / 15m (week) / 1h (month) |
| Manual refresh | Client re-fetches with `?fresh=true` (bypasses cache) |

## Environment Variables
```env
PORT=3009
REDIS_URL=redis://...
RABBITMQ_URL=amqps://...
JWT_SECRET=your-secret
ORDER_URL=http://order:3003
CATALOG_URL=http://catalog:3002
SUPPLIER_URL=http://supplier:3005
INVENTORY_URL=http://inventory:3006
AUTH_URL=http://auth:3001
```
