# Service 4: Settings

> **Port:** `3004` · **DB:** `settings_db` (Supabase) · **Message Bus:** RabbitMQ

## Tổng Quan

Service quản lý cấu hình hệ thống — bao gồm cài đặt bảo mật (Security) và chính sách bán hàng (Sales). Sử dụng **Singleton Pattern** — mỗi loại settings chỉ có 1 bản ghi duy nhất.

## Kiến Trúc

```
settings/src/
├── db/init.sql              # Schema + seed defaults
├── index.js                 # Entrypoint
├── app.js                   # Express middleware
├── routes/
│   ├── settings.routes.js   # Settings CRUD + History
│   └── health.routes.js
├── services/
│   └── settings.service.js  # Business logic
└── repositories/
    └── settings.repository.js
```

## Database Schema

| Table | Mô tả | Pattern |
|-------|--------|---------|
| `security_settings` | Cấu hình bảo mật (max_failed_attempts, lock_duration) | Singleton (`id = 1`) |
| `sales_settings` | Chính sách bán hàng (auto_promotion, discount tiers) | Singleton (`id = 1`) |
| `settings_history` | Audit log mọi thay đổi settings | Append-only |

### Security Settings (Singleton)
| Field | Default | Mô tả |
|-------|---------|-------|
| `max_failed_attempts` | `5` | Số lần đăng nhập sai tối đa |
| `lock_duration_minutes` | `30` | Thời gian khóa tài khoản |

### Sales Settings (Singleton)
| Field | Default | Mô tả |
|-------|---------|-------|
| `auto_promotion_enabled` | `false` | Tự động áp dụng khuyến mãi |
| `promotion_start_time` | `18:00` | Giờ bắt đầu khuyến mãi |
| `promotion_discount_percentage` | `20` | % giảm khuyến mãi |
| `discount_retail` | `0%` | Chiết khấu khách lẻ |
| `discount_wholesale` | `5%` | Chiết khấu khách sỉ |
| `discount_vip` | `10%` | Chiết khấu khách VIP |

## API Endpoints

| Method | Endpoint | Auth | Mô tả |
|--------|----------|:----:|-------|
| `GET` | `/api/settings/security` | 🔑 | Lấy cấu hình bảo mật |
| `PUT` | `/api/settings/security` | 🔑 | Cập nhật cấu hình bảo mật |
| `GET` | `/api/settings/sales` | 🔑 | Lấy chính sách bán hàng |
| `PUT` | `/api/settings/sales` | 🔑 | Cập nhật chính sách bán hàng |
| `GET` | `/api/settings/history` | 🔑 | Lịch sử thay đổi settings |
| `GET` | `/api/customer-discount-settings` | 🔑 | Lấy discount tiers cho frontend |
| `GET` | `/api/config` | 🔑 | Cấu hình chung hệ thống |

## Logic Nghiệp Vụ

### 1. Audit Trail
- Mọi thay đổi settings → ghi `settings_history` (old_value, new_value, changed_by, reason)
- Frontend hiển thị lịch sử dạng timeline

### 2. Customer Discount Tiers
- `discount_retail` -> applied when `customer_type = 'retail'`
- `discount_wholesale` -> applied when `customer_type = 'wholesale'`
- `discount_vip` -> applied when `customer_type = 'vip'`
- Order Service fetches discount from Settings when creating orders

### 3. Integration Points

| Consumer | API Used | Purpose |
|----------|---------|---------|
| Frontend (POS) | `GET /api/customer-discount-settings` | Load discount tiers at POS initialization |
| Frontend (Admin) | `GET /api/settings/security` + `GET /api/settings/sales` | Settings management page |
| Order Service | `GET /api/config` | Fetch active discount rates during order creation |
| Chatbot Service | `GET /api/settings/sales` | Inform VIP/wholesale customers about their discount (personalization) |

### 4. Auto Promotion (Planned)

When `auto_promotion_enabled = true`:
- Products approaching expiry get auto-discounted after `promotion_start_time`
- Discount percentage: `promotion_discount_percentage` (default 20%)
- Frontend POS should check and apply automatically

## Environment Variables
```env
PORT=3004
DATABASE_URL=postgresql://...
RABBITMQ_URL=amqps://...
JWT_SECRET=your-secret
```
