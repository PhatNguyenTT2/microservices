# Service 2: Catalog

> **Port:** `3002` · **DB:** `catalog_db` (Supabase) · **Message Bus:** RabbitMQ

## Tổng Quan

Service quản lý danh mục sản phẩm (Product Catalog) và phân loại (Categories). Dữ liệu **centralized** — không phân theo `store_id` vì catalog dùng chung toàn chuỗi.

## Kiến Trúc

```
catalog/src/
├── db/init.sql              # Schema (no seed data)
├── index.js                 # Entrypoint
├── app.js                   # Express middleware
├── routes/
│   ├── product.routes.js    # CRUD sản phẩm
│   ├── category.routes.js   # CRUD danh mục
│   └── health.routes.js     # Health check
├── services/
│   ├── product.service.js   # Product business logic
│   └── category.service.js  # Category business logic
└── repositories/
    ├── product.repository.js
    └── category.repository.js
```

## Database Schema

| Table | Mô tả | Multi-Tenancy |
|-------|--------|:---:|
| `category` | Danh mục sản phẩm (hỗ trợ hierarchy qua `parent_id`) | ❌ Centralized |
| `product` | Sản phẩm (name, unit_price, vendor, image) | ❌ Centralized |
| `product_price_history` | Lịch sử thay đổi giá | ❌ Centralized |

### Quan hệ
```
category (1) ──── (*) product
product  (1) ──── (*) product_price_history
category (self-ref) ──── parent_id → category.id  (tree structure)
```

## API Endpoints

### Products
| Method | Endpoint | Auth | Mô tả |
|--------|----------|:----:|-------|
| `GET` | `/api/products` | 🔑 | Danh sách sản phẩm (filter by category, search) |
| `GET` | `/api/products/:id` | 🔑 | Chi tiết sản phẩm |
| `POST` | `/api/products` | 🔑 | Tạo sản phẩm mới |
| `PUT` | `/api/products/:id` | 🔑 | Cập nhật sản phẩm |
| `DELETE` | `/api/products/:id` | 🔑 | Xóa sản phẩm |
| `GET` | `/api/products/:id/price-history` | 🔑 | Lịch sử giá |

### Categories
| Method | Endpoint | Auth | Mô tả |
|--------|----------|:----:|-------|
| `GET` | `/api/categories` | 🔑 | Danh sách danh mục (tree) |
| `GET` | `/api/categories/:id` | 🔑 | Chi tiết danh mục |
| `POST` | `/api/categories` | 🔑 | Tạo danh mục |
| `PUT` | `/api/categories/:id` | 🔑 | Cập nhật danh mục |
| `DELETE` | `/api/categories/:id` | 🔑 | Xóa danh mục (cascade con) |

## Logic Nghiệp Vụ

### 1. Category Hierarchy (Tree)
- `parent_id = NULL` → Root category
- Hỗ trợ nhiều cấp lồng nhau
- Xóa category cha → CASCADE xóa tất cả con

### 2. Price History Tracking
- Mỗi lần cập nhật `unit_price` → tự động ghi 1 bản ghi `product_price_history`
- Lưu `old_price`, `new_price`, `changed_by`, `reason`

### 3. Cross-Service References
- `product.id` is referenced by:
  - **Inventory Service** (`product_batch.product_id`) -- batch-level stock tracking
  - **Order Service** (`sale_order_detail.product_name` -- **snapshot**, not FK)
  - **Supplier Service** (`purchase_order_detail.product_id`)
  - **Chatbot Service** (`product_knowledge_base.product_id`) -- RAG vector embeddings

### 4. Price Architecture

Two price levels exist in the system:
- **Catalog price** (`product.unit_price`): Standard retail price across all stores
- **Batch price** (`product_batch.unit_price` in Inventory): Actual selling price per store (may differ)

POS and frontend use batch price when available, fallback to catalog price.

## Event Publishing (Planned)

| Event | Trigger | Subscribers |
|-------|---------|-------------|
| `product.created` | New product inserted | Chatbot (RAG sync) |
| `product.updated` | Product name/price/category changed | Chatbot (re-embed vector) |
| `product.deleted` | Product removed | Chatbot (remove from knowledge base) |

> These events are **planned** for Chatbot RAG data synchronization.
> Currently, Chatbot uses HTTP calls + cron-based full-sync as fallback.

## Environment Variables
```env
PORT=3002
DATABASE_URL=postgresql://...
RABBITMQ_URL=amqps://...
JWT_SECRET=your-secret
```
