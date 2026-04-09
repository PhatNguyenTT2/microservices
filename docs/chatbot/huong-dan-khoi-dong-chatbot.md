# Phase B: Khởi Động Chatbot Service & Kiểm Tra Data Ingestion

> Hướng dẫn chi tiết từng bước khởi động chatbot service và giám sát quá trình nạp dữ liệu RAG.

---

## Bước 1: Kiểm tra Environment Variables

File `.env` tại `microservices/.env` — chatbot cần các biến sau:

```env
# Bắt buộc (đã có sẵn)
DATABASE_URL=postgresql://...         ← Supabase PostgreSQL
RABBITMQ_URL=amqps://...              ← CloudAMQP RabbitMQ
JWT_SECRET=...                         ← Chung với các service khác

# Chatbot-specific (đã có sẵn)
HF_ACCESS_TOKEN=hf_QLRICS...          ← HuggingFace API token
HF_MODEL=microsoft/Phi-3-mini-4k-instruct
```

> ✅ File `.env` đã có đầy đủ. Không cần thêm gì.

---

## Bước 2: Install Dependencies

```powershell
# Shared modules (nếu chưa install)
cd e:\UIT\backend\microservices\shared
npm install

# Chatbot service
cd e:\UIT\backend\microservices\services\chatbot
npm install
```

> ⚠️ Lần đầu chạy, `@xenova/transformers` sẽ tải model Vietnamese SBERT (~150MB). Cần internet.

---

## Bước 3: Khởi động các service phụ thuộc

Chatbot cần **4 service khác** chạy trước (để initial sync có data):

```powershell
# Terminal 1: Auth (:3001)
cd e:\UIT\backend\microservices\services\auth
$env:PORT="3001"; node src/index.js

# Terminal 2: Catalog (:3002) 
cd e:\UIT\backend\microservices\services\catalog
$env:PORT="3002"; node src/index.js

# Terminal 3: Inventory (:3006)
cd e:\UIT\backend\microservices\services\inventory
$env:PORT="3006"; node src/index.js

# Terminal 4: Order (:3003)
cd e:\UIT\backend\microservices\services\order
$env:PORT="3003"; node src/index.js
```

Hoặc dùng **Docker** (khuyên dùng):
```powershell
cd e:\UIT\backend\microservices
docker compose up auth catalog inventory order -d
```

---

## Bước 4: Khởi động Chatbot Service

### Chạy local (dev — chatbot trên host, services trong Docker)

> ⚠️ **Quan trọng:** Khi chạy local, cần:
> 1. Load `.env` file thủ công (Docker Compose tự load, nhưng `npm run dev` thì không)
> 2. Override service URLs thành `localhost` (Docker DNS `http://auth:3001` chỉ resolve trong Docker network)

**Lệnh khởi động đầy đủ (PowerShell):**
```powershell
cd e:\UIT\backend\microservices\services\chatbot

# Load .env + override URLs cho local dev
Get-Content "e:\UIT\backend\microservices\.env" | ForEach-Object {
  if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
    [System.Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), 'Process')
  }
}
$env:CATALOG_SERVICE_URL="http://localhost:3002"
$env:INVENTORY_SERVICE_URL="http://localhost:3006"
$env:ORDER_SERVICE_URL="http://localhost:3003"
$env:AUTH_SERVICE_URL="http://localhost:3001"
node src/index.js
```

### Chạy toàn bộ trong Docker

```powershell
cd e:\UIT\backend\microservices
docker compose up --build
```

---

## Bước 5: Đọc Log — Hiểu Chatbot khởi động như thế nào

Terminal sẽ hiện log theo **đúng thứ tự 12 bước** (từ `index.js`):

### Giai đoạn 1: Kết nối hạ tầng (0-2s)

```
{"level":30,"msg":"Database schema initialized for chatbot"}    ← Bước 1: PostgreSQL OK
{"level":30,"msg":"PostgreSQL connected"}
{"level":30,"msg":"RabbitMQ connected"}                         ← Bước 2: RabbitMQ OK
```

### Giai đoạn 2: Load AI models (2-10s)

```
{"level":30,"msg":"Internal API client ready (Catalog, Inventory, Order, Auth)"}  ← Bước 4
```

Rồi sẽ thấy **Embedding model đang load**:
```
<im quá trình load — không có log trực tiếp, chờ khoảng 3-8 giây>
```

**Nếu thành công:**
```
{"level":30,"msg":"RAG Service initialized (Hybrid Search + RRF)"}   ← ✅ RAG sẵn sàng
```

**Nếu thất bại** (thiếu RAM, model lỗi):
```
{"level":50,"msg":"Embedding model failed to load — RAG will be disabled"}  ← ❌ RAG tắt
{"level":40,"msg":"RAG Service DISABLED — embedding model not loaded"}
```

> 💡 Nếu RAG disabled: Bot vẫn hoạt động với CHECK_STOCK, CHECK_PRICE, ORDER_STATUS, HELP, FREE_CHAT. Chỉ RECOMMENDATION và SEARCH_PRODUCT mất tính năng AI.

### Giai đoạn 3: Đăng ký events (10s)

```
{"level":30,"msg":"Event subscriptions registered (product.*, inventory.updated, order.completed)"}
{"level":30,"msg":"Cron scheduled: full sync every 30 minutes"}
{"level":30,"msg":"Socket.IO initialized on /ws/chat"}
{"level":30,"msg":"chatbot-service running on port 3008 (HTTP + WebSocket + RAG)"}  ← ✅ Server sẵn sàng
```

### Giai đoạn 4: Initial Data Sync (sau 10s delay)

Đây là phần quan trọng nhất — bot tự động nạp dữ liệu:

```
{"level":30,"msg":"Startup: Running initial data sync..."}       ← Bắt đầu sync
{"level":30,"msg":"RAG Data Ingestion: Starting full sync..."}
```

**Trong quá trình sync, bạn sẽ thấy:**

1. **Lấy danh sách stores** → gọi Auth service
2. **Lấy tất cả sản phẩm** → gọi Catalog service `GET /api/products`
3. **Lấy tồn kho từng store** → gọi Inventory `GET /api/inventory/summary?storeId=X`
4. **Với mỗi (product × store):**
   - Tạo content text: `"[Tên SP] | Danh mục: [Cat] | Giá: [X]đ | ..."`
   - Embed text → vector 768 chiều (chạy local, ~50-100ms/sản phẩm)
   - UPSERT vào `product_knowledge_base` (pgvector)

**Khi sync xong:**
```json
{"level":30,"synced":150,"skipped":5,"storeCount":2,"durationMs":45000,
 "msg":"RAG Data Ingestion: Full sync completed"}
{"level":30,"msg":"Startup: Initial sync completed"}              ← ✅ Sync hoàn tất
```

**Nếu sync thất bại** (service phụ thuộc chưa chạy):
```json
{"level":50,"msg":"Startup: Initial sync failed (will retry at next cron)"}
```

> ⚠️ Nếu thất bại: Không cần lo — Cron sẽ tự retry mỗi 30 phút, hoặc bạn restart chatbot.

---

## Bước 6: Kiểm Tra Trạng Thái Sau Khởi Động

### 6.1. Health Check

```powershell
curl http://localhost:3008/health
```

**Expected:**
```json
{
  "status": "ok",
  "service": "chatbot-service",
  "timestamp": "2026-04-09T01:30:00.000Z"
}
```

### 6.2. Readiness Check (bao gồm dependencies)

```powershell
curl http://localhost:3008/ready
```

**Expected:**
```json
{
  "status": "ready",
  "service": "chatbot-service",
  "dependencies": {
    "postgres": { "connected": true },
    "hf_model": "microsoft/Phi-3-mini-4k-instruct"
  }
}
```

### 6.3. RAG Knowledge Base Stats ⭐

Đây là endpoint **quan trọng nhất** để kiểm tra data ingestion:

```powershell
# Tổng tất cả stores
curl http://localhost:3008/api/rag/stats

# Theo store cụ thể
curl "http://localhost:3008/api/rag/stats?storeId=1"
```

**Response mẫu:**
```json
{
  "success": true,
  "data": {
    "total_entries": "150",          ← Tổng SP trong knowledge base
    "in_stock_count": "120",         ← SP đang còn hàng
    "out_of_stock_count": "30",      ← SP đã hết
    "oldest_sync": "2026-04-09T01:30:10.000Z",
    "latest_sync": "2026-04-09T01:31:45.000Z"
  }
}
```

### Cách đọc kết quả:

| Kết quả | Ý nghĩa | Hành động |
|---------|---------|-----------|
| `total_entries > 0` | ✅ Sync thành công | Sẵn sàng dùng |
| `total_entries = 0` | ❌ Chưa sync hoặc thất bại | Kiểm tra log, restart chatbot |
| `in_stock_count = 0` | ⚠️ Inventory chưa có data | Kiểm tra Inventory service |
| `oldest_sync` rất cũ | ⚠️ Dữ liệu cũ | Cron 30 phút sẽ tự cập nhật |

---

## Bước 7: Kiểm Tra Real-time Event Sync

Sau khi chatbot chạy, thử thêm/sửa sản phẩm qua Catalog API và quan sát log:

### Test 1: Thêm sản phẩm mới qua Catalog

```powershell
# Đăng nhập lấy token
$token = (curl -s -X POST http://localhost:3001/api/auth/login `
  -H "Content-Type: application/json" `
  -d '{"username":"admin1","password":"password123"}' | ConvertFrom-Json).data.token

# Thêm sản phẩm
curl -X POST http://localhost:3002/api/products `
  -H "Authorization: Bearer $token" `
  -H "Content-Type: application/json" `
  -d '{"name":"Test RAG Product","categoryId":1,"unitPrice":50000}'
```

**Log chatbot sẽ hiện:**
```json
{"level":30,"productId":999,"name":"Test RAG Product","msg":"Ingesting new product"}
```

Sau 1-2 giây, kiểm tra lại stats:
```powershell
curl http://localhost:3008/api/rag/stats
# total_entries sẽ tăng thêm (số stores) entries
```

### Test 2: Cập nhật tồn kho (sau Phase A)

Khi nhập hàng qua Inventory API → log chatbot:
```json
{"level":30,"storeId":1,"productId":999,"quantityOnShelf":50,"msg":"Updating inventory in knowledge base"}
```

### Test 3: Tạo đơn hàng hoàn thành (sau Phase A)

Khi đơn chuyển sang `delivered` → log chatbot:
```json
{"level":30,"storeId":1,"itemCount":3,"msg":"Processing co-purchase pairs"}
```

---

## Bước 8: Test Chat End-to-End

```powershell
# Lấy token (dùng lại từ trên hoặc đăng nhập lại)

# 1. Tạo session
$session = (curl -s -X POST http://localhost:3008/api/chat/sessions `
  -H "Authorization: Bearer $token" | ConvertFrom-Json).data
$sid = $session.id
Write-Host "Session ID: $sid"

# 2. Test HELP (không cần AI, luôn hoạt động)
curl -X POST http://localhost:3008/api/chat/message `
  -H "Authorization: Bearer $token" `
  -H "Content-Type: application/json" `
  -d "{`"session_id`":$sid,`"message`":`"Giúp tôi`"}"

# 3. Test RECOMMENDATION (RAG pipeline — cần sync xong)
curl -X POST http://localhost:3008/api/chat/message `
  -H "Authorization: Bearer $token" `
  -H "Content-Type: application/json" `
  -d "{`"session_id`":$sid,`"message`":`"Gợi ý bia ngon`"}"

# 4. Test reformulation (nhớ ngữ cảnh)
curl -X POST http://localhost:3008/api/chat/message `
  -H "Authorization: Bearer $token" `
  -H "Content-Type: application/json" `
  -d "{`"session_id`":$sid,`"message`":`"Nó còn hàng không?`"}"
```

---

## Sơ đồ trình tự khởi động

```
[Thời gian]  [Sự kiện]                              [Cách kiểm tra]
───────────────────────────────────────────────────────────────
  0s         PostgreSQL connected                   curl /health
  0s         RabbitMQ connected                     
  3-8s       SBERT model loaded (768d, CPU)         Log: "RAG Service initialized"
  8s         Server running on :3008                curl /health
  8s         Events subscribed                      
  10s        Initial sync bắt đầu                   Log: "Starting full sync"
  10-60s     Embedding + UPSERT từng product        Log: từng product (nếu debug)
  60s        Sync hoàn tất                          curl /api/rag/stats
  30min      Cron full-sync lặp lại                 Log: "Cron: Starting scheduled..."
  Real-time  product.*/inventory.updated events     Log: "Ingesting..."/"Updating..."
```

---

## Troubleshooting

| Lỗi | Nguyên nhân | Cách fix |
|-----|------------|---------|
| `ECONNREFUSED :3002` | Catalog chưa chạy | Khởi động Catalog trước |
| `ECONNREFUSED :3006` | Inventory chưa chạy | Khởi động Inventory trước |
| `Embedding model failed to load` | Thiếu RAM hoặc model chưa tải | Cần ~500MB RAM trống. Thử restart |
| `HF_ACCESS_TOKEN not set` | Thiếu token HuggingFace | Thêm `HF_ACCESS_TOKEN` vào .env |
| `total_entries = 0` sau 2 phút | Catalog không có sản phẩm | Kiểm tra `GET /api/products` ở Catalog |
| `Connection refused RabbitMQ` | CloudAMQP down hoặc sai URL | Kiểm tra `RABBITMQ_URL` trong .env |
