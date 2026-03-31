# 🚀 POSMART Backend — Hướng dẫn khởi động

## Yêu cầu

| Tool | Version | Kiểm tra |
|------|---------|----------|
| Node.js | ≥ 20 | `node -v` |
| Docker + Docker Compose | ≥ 24 | `docker --version` |
| Git | Bất kỳ | `git --version` |

---

## 1. Cài đặt dependencies

```bash
cd microservices
npm install
```

> Lệnh trên sẽ cài dependencies cho **tất cả 8 services** + shared libs nhờ npm workspaces.

---

## 2. Cấu hình môi trường

Tạo file `.env` tại thư mục `microservices/`:

```env
# JWT
JWT_SECRET=your-secret-key-here

# Hugging Face (cho AI Chatbot)
HF_ACCESS_TOKEN=hf_xxxxxxxxxxxxxxxxxxxxx
HF_MODEL=microsoft/Phi-3-mini-4k-instruct

# VNPay (cho Payment service)
VNP_TMNCODE=DEMOCODE
VNP_HASHSECRET=DEMOSECRET
VNP_URL=https://sandbox.vnpayment.vn
```

---

## 3. Khởi động

### Cách 1: Docker Compose (Khuyến nghị — đầy đủ hệ thống)

```bash
cd microservices

# Khởi động toàn bộ (8 services + PostgreSQL + RabbitMQ + Nginx Gateway)
docker compose up --build

# Hoặc chạy nền
docker compose up --build -d
```

Sau khi khởi động, hệ thống sẵn sàng tại:

| Thành phần | URL | Mô tả |
|------------|-----|-------|
| **API Gateway** | http://localhost:8080 | Nginx reverse proxy |
| Auth | http://localhost:3001 | Đăng nhập, phân quyền |
| Catalog | http://localhost:3002 | Sản phẩm, danh mục |
| Order | http://localhost:3003 | Đơn hàng |
| Settings | http://localhost:3004 | Cấu hình hệ thống |
| Supplier | http://localhost:3005 | Nhà cung cấp, nhập hàng |
| Inventory | http://localhost:3006 | Tồn kho, xuất kho |
| Payment | http://localhost:3007 | Thanh toán (VNPay) |
| Chatbot | http://localhost:3008 | AI Chatbot (HF + WebSocket) |
| RabbitMQ UI | http://localhost:15672 | `posmart` / `posmart_secret` |

### Cách 2: Chạy từng service riêng lẻ (Dev mode)

> **Lưu ý:** Cần khởi động PostgreSQL + RabbitMQ trước (bằng Docker hoặc local).

```bash
# Chỉ chạy infra
docker compose up postgres rabbitmq -d

# Chạy từng service (chọn service cần dev)
npm run dev:auth
npm run dev:catalog
npm run dev:order
npm run dev:settings
npm run dev:supplier
npm run dev:inventory
npm run dev:payment
npm run dev:chatbot
```

Mỗi service sẽ cần biến môi trường riêng:

```bash
# Ví dụ: chạy Auth service
DATABASE_URL=postgresql://posmart:posmart_secret@localhost:5432/auth_db \
RABBITMQ_URL=amqp://posmart:posmart_secret@localhost:5672 \
JWT_SECRET=your-secret \
PORT=3001 \
npm run dev:auth
```

---

## 4. Kiểm tra health

```bash
# Qua Gateway
curl http://localhost:8080/health/auth
curl http://localhost:8080/health/catalog
curl http://localhost:8080/health/chatbot

# Trực tiếp
curl http://localhost:3001/health
```

---

## 5. Chạy test

```bash
cd microservices

# Test tất cả services
npm test

# Test từng service
npm run test:auth
npm run test:catalog
npm run test:order
npm run test:settings
npm run test:supplier
npm run test:inventory
npm run test:payment
npm run test:chatbot
```

---

## 6. Kiến trúc tổng quan

```
Client → Nginx Gateway (:8080)
           ├── /api/auth/*       → Auth (:3001)
           ├── /api/products/*   → Catalog (:3002)
           ├── /api/categories/* → Catalog (:3002)
           ├── /api/orders/*     → Order (:3003)
           ├── /api/settings/*   → Settings (:3004)
           ├── /api/suppliers/*  → Supplier (:3005)
           ├── /api/inventory/*  → Inventory (:3006)
           ├── /api/payments/*   → Payment (:3007)
           ├── /api/chat/*       → Chatbot (:3008)
           └── /ws/chat/         → Chatbot WebSocket (:3008)

Infrastructure:
  PostgreSQL :5432 (8 databases)
  RabbitMQ   :5672 (event bus)
```

---

## 7. Dừng hệ thống

```bash
# Dừng toàn bộ
docker compose down

# Dừng + xóa data (reset database)
docker compose down -v
```

---

## Xử lý lỗi thường gặp

| Lỗi | Nguyên nhân | Cách sửa |
|-----|-------------|----------|
| `ECONNREFUSED :5432` | PostgreSQL chưa sẵn sàng | Chờ healthcheck hoặc `docker compose up postgres -d` |
| `ECONNREFUSED :5672` | RabbitMQ chưa sẵn sàng | Chờ healthcheck hoặc `docker compose up rabbitmq -d` |
| `HF_ACCESS_TOKEN not set` | Thiếu token Hugging Face | Thêm vào `.env` |
| Port đã bị chiếm | Service khác đang chạy | Kiểm tra `netstat -ano \| findstr :3001` |