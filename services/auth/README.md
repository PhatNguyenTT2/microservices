# Service 1: Auth & Identity

> **Port:** `3001` · **DB:** `auth_db` (Supabase) · **Message Bus:** RabbitMQ

## Tổng Quan

Service quản lý xác thực (Authentication), phân quyền (RBAC), và hồ sơ người dùng (Identity). Là **nền tảng tenancy** cho toàn bộ hệ thống — mỗi nhân viên thuộc một `store_id` xác định.

## Kiến Trúc

```
auth/src/
├── db/init.sql              # Schema + seed data
├── index.js                 # Entrypoint, RabbitMQ connect
├── app.js                   # Express middleware stack
├── routes/
│   ├── auth.routes.js       # Login, Register, Token Refresh
│   ├── customer.routes.js   # CRUD khách hàng
│   ├── employee.routes.js   # CRUD nhân viên
│   ├── rbac.routes.js       # Roles & Permissions
│   ├── store.routes.js      # CRUD cửa hàng
│   └── health.routes.js     # Health check
├── services/                # Business logic
└── repositories/            # Data access layer
```

## Database Schema

| Table | Mô tả | Multi-Tenancy |
|-------|--------|:---:|
| `store` | Cửa hàng (Tenancy root) | — |
| `user_account` | Tài khoản đăng nhập (username, email, password_hash) | Chain-wide |
| `employee` | Hồ sơ nhân viên (gắn `store_id`) | ✅ |
| `customer` | Hồ sơ khách hàng (walk-in: `user_id = NULL`) | Chain-wide |
| `role` | Vai trò (admin, manager, cashier...) | Chain-wide |
| `permission` | Quyền hạn (code-based) | Chain-wide |
| `role_permission` | Mapping N:N | — |
| `auth_tokens` | Refresh tokens & Password reset | — |
| `pos_auth` | PIN-based auth cho POS | — |

## API Endpoints

### Authentication
| Method | Endpoint | Auth | Mô tả |
|--------|----------|:----:|-------|
| `POST` | `/api/auth/login` | ❌ | Đăng nhập (email + password → JWT) |
| `POST` | `/api/auth/register` | ❌ | Đăng ký tài khoản |
| `POST` | `/api/auth/refresh` | 🔑 | Làm mới JWT token |

### Employees
| Method | Endpoint | Auth | Mô tả |
|--------|----------|:----:|-------|
| `GET` | `/api/employees` | 🔑 | Danh sách nhân viên |
| `GET` | `/api/employees/:id` | 🔑 | Chi tiết nhân viên |
| `PUT` | `/api/employees/:id` | 🔑 | Cập nhật hồ sơ |

### Customers
| Method | Endpoint | Auth | Mô tả |
|--------|----------|:----:|-------|
| `GET` | `/api/customers` | 🔑 | Danh sách khách hàng |
| `GET` | `/api/customers/:id` | 🔑 | Chi tiết khách hàng |
| `POST` | `/api/customers` | 🔑 | Tạo khách hàng mới |
| `PUT` | `/api/customers/:id` | 🔑 | Cập nhật khách hàng |

### RBAC (Roles & Permissions)
| Method | Endpoint | Auth | Mô tả |
|--------|----------|:----:|-------|
| `GET` | `/api/roles` | 🔑 | Danh sách vai trò |
| `GET` | `/api/permissions` | 🔑 | Danh sách quyền hạn |

### Stores
| Method | Endpoint | Auth | Mô tả |
|--------|----------|:----:|-------|
| `GET` | `/api/stores` | 🔑 | Danh sách cửa hàng |
| `POST` | `/api/stores` | 🔑 | Tạo cửa hàng |

## Logic Nghiệp Vụ

### 1. Đăng nhập (Login Flow)
```
Client → POST /auth/login { email, password }
  → Validate credentials
  → Generate JWT { userId, storeId, roleId }
  → Return { token, refreshToken, employee }
```

### 2. Multi-Tenancy
- JWT chứa `storeId` → tất cả service downstream đều dùng `storeId` để lọc data
- Employee gắn với 1 store, Customer là chain-wide (không thuộc store nào)

### 3. Customer Types
- `guest` — Khách vãng lai
- `retail` — Khách lẻ
- `wholesale` — Khách sỉ
- `vip` — Khách VIP (>= threshold spending)

## Seed Data
- 15 walk-in customers with Vietnamese sample data
- Default roles & permissions (via API)

## Cross-Service Data Pattern

### Customer Data -- Source of Truth

Auth Service **owns** all customer data (`fullName`, `phone`, `customerType`, `totalSpent`).
Other services (Order, StockOut) only store `customer_id` as a foreign key reference.

| Consumer | Field Stored | Resolution Method |
|----------|-------------|-------------------|
| Order Service | `customer_id` (integer FK) | Frontend calls `GET /api/customers/:id` |
| StockOut Service | `created_by` (employee FK) | Frontend calls `GET /api/employees/:id` |
| POS Frontend | Local cart state | Fetched at POS login, cached in memory |

### formatCustomer() Response Format

Returns **camelCase** fields:
```json
{
  "id": 1,
  "fullName": "Nguyen Van An",
  "phone": "0901234567",
  "customerType": "retail",
  "totalSpent": 1500000,
  "isActive": true,
  "hasAccount": false
}
```

### Employee Data

`formatEmployee()` also returns camelCase (`fullName`, `phone`, `position`).
StockOut and Order pages use `_createdByName` enriched field via Client-Side Join.

### Future Plan: Data Replication

When migrating to Database-per-Service (separate DBs), Auth will publish customer lifecycle events:
- `customer.created` / `customer.updated` / `customer.deleted`
- Order Service will maintain a local `customer_cache` table

Detailed plan: `docs/improve/data-replication-customer.md`

## Environment Variables
```env
PORT=3001
DATABASE_URL=postgresql://...
RABBITMQ_URL=amqps://...
JWT_SECRET=your-secret
JWT_EXPIRES_IN=7d
```
