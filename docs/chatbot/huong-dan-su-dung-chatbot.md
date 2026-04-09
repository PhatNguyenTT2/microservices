# 🚀 Hướng Dẫn Nhanh: Chatbot AI POSMART

> Hướng dẫn sử dụng module Chatbot AI cho hệ thống quản lý chuỗi siêu thị POSMART.
> Dành cho **lập trình viên frontend** và **người mới bắt đầu tích hợp**.

---

## 📋 Mục lục

1. [Tổng quan](#1-tổng-quan)
2. [Yêu cầu trước khi bắt đầu](#2-yêu-cầu-trước-khi-bắt-đầu)
3. [Kết nối qua REST API](#3-kết-nối-qua-rest-api)
4. [Kết nối qua WebSocket (Real-time)](#4-kết-nối-qua-websocket-real-time)
5. [Chatbot hiểu được những gì?](#5-chatbot-hiểu-được-những-gì)
6. [Ví dụ hội thoại thực tế](#6-ví-dụ-hội-thoại-thực-tế)
7. [Xử lý lỗi thường gặp](#7-xử-lý-lỗi-thường-gặp)
8. [FAQ](#8-faq)

---

## 1. Tổng quan

Chatbot POSMART là trợ lý AI hỗ trợ **nhân viên** và **khách hàng** trong các tác vụ:

| Chức năng | Ví dụ |
|-----------|-------|
| 🔍 Kiểm tra tồn kho | *"Coca Cola còn hàng không?"* |
| 💰 Kiểm tra giá | *"Pepsi 330ml giá bao nhiêu?"* |
| 📦 Tra cứu đơn hàng | *"Đơn hàng #123 đến đâu rồi?"* |
| 🛒 Tìm kiếm sản phẩm | *"Tìm nước rửa tay"* |
| 💡 Gợi ý thông minh (AI) | *"Tư vấn nên mua gì làm quà?"* |
| 💬 Trò chuyện tự do | *"Chào buổi sáng!"* |

**Hai cách kết nối:**
- **REST API** — Dùng cho giao diện chat đơn giản (request/response)
- **WebSocket (Socket.IO)** — Dùng cho chat real-time (typing indicator, instant reply)

---

## 2. Yêu cầu trước khi bắt đầu

### 2.1. Lấy JWT Token

Tất cả API chatbot đều yêu cầu **JWT Token**. Lấy token bằng cách đăng nhập:

```bash
# Đăng nhập
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "employee1", "password": "password123"}'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "user": { "id": 1, "role": "Employee", "storeId": 1 }
  }
}
```

> 📌 **Lưu lại `token`** — Dùng cho tất cả request tiếp theo.

### 2.2. Base URL

| Môi trường | URL |
|-----------|-----|
| Local dev | `http://localhost:3008` |
| Docker | `http://chatbot:3008` |

---

## 3. Kết nối qua REST API

### Bước 1: Tạo phiên chat

```bash
curl -X POST http://localhost:3008/api/chat/sessions \
  -H "Authorization: Bearer <TOKEN>"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "user_id": 1,
    "user_type": "employee",
    "store_id": 1,
    "is_active": true,
    "started_at": "2026-04-08T14:00:00.000Z"
  }
}
```

> 📌 **Lưu lại `id`** (session_id) — Dùng cho mọi tin nhắn tiếp theo.

### Bước 2: Gửi tin nhắn

```bash
curl -X POST http://localhost:3008/api/chat/message \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": 1,
    "message": "Coca Cola còn hàng không?"
  }'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "intent": "CHECK_STOCK",
    "reply": "Dạ, Coca Cola 330ml hiện còn 24 sản phẩm trên kệ tại chi nhánh của bạn ạ!",
    "products": null,
    "metadata": {
      "model": "microsoft/Phi-3-mini-4k-instruct",
      "latencyMs": 850,
      "intent": { "intent": "CHECK_STOCK", "confidence": "keyword_match", "matchedKeyword": "còn hàng" },
      "apiCalled": "inventory:summary"
    }
  }
}
```

### Bước 3: Xem lịch sử chat

```bash
# Xem chi tiết session + messages
curl http://localhost:3008/api/chat/sessions/1 \
  -H "Authorization: Bearer <TOKEN>"
```

### Bước 4: Kết thúc phiên

```bash
curl -X POST http://localhost:3008/api/chat/sessions/1/end \
  -H "Authorization: Bearer <TOKEN>"
```

### Tóm tắt REST API

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `POST` | `/api/chat/sessions` | Tạo phiên chat mới |
| `GET` | `/api/chat/sessions` | Danh sách phiên chat của user |
| `GET` | `/api/chat/sessions/:id` | Chi tiết phiên + tin nhắn |
| `POST` | `/api/chat/sessions/:id/end` | Kết thúc phiên |
| `POST` | `/api/chat/message` | **Gửi tin nhắn** (endpoint chính) |
| `GET` | `/health` | Kiểm tra service |
| `GET` | `/ready` | Kiểm tra service + dependencies |

---

## 4. Kết nối qua WebSocket (Real-time)

### 4.1. Cài đặt Socket.IO Client

```bash
npm install socket.io-client
```

### 4.2. Kết nối

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3008', {
  auth: { token: '<JWT_TOKEN>' }
});

socket.on('connect', () => {
  console.log('✅ Connected to POSMART Chatbot');
});

socket.on('connect_error', (err) => {
  console.error('❌ Connection failed:', err.message);
  // Thường do token hết hạn hoặc sai
});
```

### 4.3. Bắt đầu phiên chat

```javascript
socket.emit('chat:start_session', {}, (response) => {
  if (response.success) {
    const sessionId = response.data.id;
    console.log('Session ID:', sessionId);
    // Lưu sessionId để dùng cho các tin nhắn tiếp theo
  }
});
```

### 4.4. Gửi tin nhắn

```javascript
socket.emit('chat:send_message', {
  session_id: sessionId,
  message: 'Gợi ý bia ngon đi'
}, (response) => {
  // Callback: nhận response ngay
  console.log('Bot:', response.data.reply);
  console.log('Intent:', response.data.intent);
  console.log('Products:', response.data.products);
});
```

### 4.5. Lắng nghe sự kiện

```javascript
// Bot đang gõ... (hiển thị typing indicator trên UI)
socket.on('chat:typing', (data) => {
  if (data.is_typing) {
    showTypingIndicator();  // Hiện "Bot đang trả lời..."
  } else {
    hideTypingIndicator();  // Ẩn indicator
  }
});

// Nhận tin nhắn (ngoài callback)
socket.on('chat:message_received', (data) => {
  appendMessage('bot', data.data.reply);
});

// Lỗi
socket.on('chat:error', (err) => {
  console.error('Chat error:', err.error.message);
});
```

### 4.6. Kết thúc

```javascript
socket.emit('chat:end_session', { session_id: sessionId }, (response) => {
  console.log('Session ended');
});

socket.disconnect();
```

### Tóm tắt Socket Events

| Event (Client → Server) | Payload | Callback |
|---|---|---|
| `chat:start_session` | `{}` | `{ success, data: session }` |
| `chat:send_message` | `{ session_id, message }` | `{ success, data: { reply, intent, products } }` |
| `chat:end_session` | `{ session_id }` | `{ success, data: session }` |
| `chat:get_history` | `{ session_id }` | `{ success, data: { messages } }` |

| Event (Server → Client) | Khi nào | Payload |
|---|---|---|
| `chat:typing` | Bot đang xử lý | `{ session_id, is_typing: true/false }` |
| `chat:message_received` | Bot trả lời xong | `{ success, data: { reply, intent } }` |
| `chat:session_started` | Tạo session xong | `{ success, data: session }` |
| `chat:session_ended` | Kết thúc session | `{ success, data: session }` |
| `chat:error` | Có lỗi | `{ success: false, error: { message, code } }` |

---

## 5. Chatbot hiểu được những gì?

Chatbot tự động nhận diện **ý định (intent)** từ tin nhắn bằng keyword matching. Mỗi intent có danh sách từ khóa riêng — chỉ cần tin nhắn **chứa 1 trong các từ khóa** là bot sẽ hiểu.

### 5.1. Bảng Intent đầy đủ

#### 🔍 `CHECK_STOCK` — Kiểm tra tồn kho

**Từ khóa:** `tồn kho`, `còn hàng`, `còn không`, `hết hàng`, `có còn`, `stock`, `inventory`, `số lượng còn`

**Bot sẽ làm gì:** Tìm sản phẩm trong Catalog → Gọi Inventory API lấy số lượng → AI format thành câu trả lời.

| Câu hỏi mẫu | Từ khóa khớp |
|---|---|
| "Coca Cola **còn hàng** không?" | `còn hàng` |
| "Kiểm tra **tồn kho** mì gói" | `tồn kho` |
| "Sữa TH **hết hàng** chưa?" | `hết hàng` |
| "Bia Tiger **có còn** không?" | `có còn` |
| "Check **stock** nước ngọt" | `stock` |
| "**Số lượng còn** của bột giặt Omo" | `số lượng còn` |

#### 💰 `CHECK_PRICE` — Kiểm tra giá

**Từ khóa:** `giá`, `bao nhiêu`, `price`, `giá bán`, `giá tiền`, `chi phí`

**Bot sẽ làm gì:** Tìm sản phẩm trong Catalog → Lấy giá bán → AI format.

| Câu hỏi mẫu | Từ khóa khớp |
|---|---|
| "Pepsi 330ml **giá** bao nhiêu?" | `giá` |
| "Dầu ăn **bao nhiêu** tiền?" | `bao nhiêu` |
| "**Giá bán** nước rửa chén?" | `giá bán` |
| "**Chi phí** mua 1 thùng mì?" | `chi phí` |

#### 📦 `ORDER_STATUS` — Tra cứu đơn hàng

**Từ khóa:** `đơn hàng`, `order`, `tracking`, `giao hàng`, `trạng thái đơn`, `đơn #`, `mã đơn`

**Bot sẽ làm gì:**
- Nếu có **mã đơn** (ví dụ #123): Lấy thông tin đơn cụ thể.
- Nếu **không có mã**: Liệt kê 5 đơn hàng gần nhất.

| Câu hỏi mẫu | Kết quả |
|---|---|
| "**Đơn hàng** #789 đến đâu rồi?" | Chi tiết đơn #789 |
| "**Tracking** đơn 456" | Chi tiết đơn #456 |
| "Kiểm tra **đơn hàng**" | 5 đơn gần nhất |
| "**Mã đơn** 321 trạng thái gì?" | Chi tiết đơn #321 |

#### 💡 `RECOMMENDATION` — Gợi ý sản phẩm (AI nâng cao)

**Từ khóa:** `gợi ý`, `recommend`, `đề xuất`, `tư vấn`, `nên mua`, `mua gì`, `có gì ngon`, `giới thiệu`, `best seller`, `bán chạy`, `phổ biến`

**Bot sẽ làm gì:** Kích hoạt pipeline RAG 7 bước:
1. Hiểu lại câu hỏi (reformulate nếu mơ hồ)
2. Tìm kiếm ngữ nghĩa (vector similarity + keyword)
3. Xếp hạng kết quả (RRF fusion)
4. Bổ sung sản phẩm mua kèm (co-purchase)
5. Cá nhân hóa theo loại khách (VIP/sỉ/lẻ)
6. Sinh câu trả lời tự nhiên bằng AI

| Câu hỏi mẫu | Từ khóa khớp |
|---|---|
| "**Tư vấn** nên mua quà gì?" | `tư vấn` |
| "**Gợi ý** bia ngon" | `gợi ý` |
| "**Nên mua** gì cho bữa tiệc?" | `nên mua` |
| "Có **gì ngon** ở đây?" | `có gì ngon` |
| "Sản phẩm **bán chạy** nhất?" | `bán chạy` |
| "**Giới thiệu** đồ ăn vặt" | `giới thiệu` |

> ⚡ Đây là intent mạnh nhất — trả về danh sách sản phẩm kèm giá, số lượng tồn kho, và gợi ý mua kèm.

#### 🛒 `SEARCH_PRODUCT` — Tìm kiếm sản phẩm

**Từ khóa:** `tìm`, `search`, `có gì`, `sản phẩm nào`, `loại nào`, `tìm kiếm`

**Bot sẽ làm gì:** Nếu có RAG → tìm kiếm ngữ nghĩa (giống RECOMMENDATION). Nếu không → tìm theo tên qua Catalog API.

| Câu hỏi mẫu | Từ khóa khớp |
|---|---|
| "**Tìm** nước rửa tay" | `tìm` |
| "**Có gì** về sữa tắm?" | `có gì` |
| "**Sản phẩm nào** đang giảm giá?" | `sản phẩm nào` |
| "**Loại nào** phù hợp cho da nhạy cảm?" | `loại nào` |

#### ❓ `HELP` — Yêu cầu trợ giúp

**Từ khóa:** `help`, `giúp`, `hướng dẫn`, `làm sao`, `cách`, `hỗ trợ`

**Bot sẽ làm gì:** Trả về menu trợ giúp tĩnh (không gọi AI).

#### 💬 `FREE_CHAT` — Trò chuyện tự do

**Kích hoạt:** Khi tin nhắn **không chứa keyword nào** ở trên.

**Bot sẽ làm gì:** Trả lời bằng AI (Phi-3) dựa trên ngữ cảnh hội thoại.

| Câu hỏi mẫu | Lý do |
|---|---|
| "Xin chào!" | Không keyword |
| "Hôm nay trời đẹp quá" | Không keyword |
| "Cảm ơn bạn" | Không keyword |

### 5.2. Thứ tự ưu tiên Intent

Nếu tin nhắn chứa **nhiều keyword** từ các intent khác nhau, bot sẽ chọn intent **đầu tiên** theo thứ tự ưu tiên:

```
CHECK_STOCK → CHECK_PRICE → ORDER_STATUS → RECOMMENDATION → SEARCH_PRODUCT → HELP → FREE_CHAT
```

**Ví dụ:**
```
"Tìm sản phẩm giá dưới 50k"
  → "giá" khớp CHECK_PRICE (ưu tiên 2)
  → "tìm" khớp SEARCH_PRODUCT (ưu tiên 5)
  → Kết quả: CHECK_PRICE ✅ (ưu tiên cao hơn)

"Sản phẩm này còn hàng không, giá bao nhiêu?"
  → "còn hàng" khớp CHECK_STOCK (ưu tiên 1)
  → "giá" khớp CHECK_PRICE (ưu tiên 2)
  → Kết quả: CHECK_STOCK ✅
```

> 💡 **Tip:** Nếu muốn hỏi nhiều thông tin, hãy **chia thành 2 tin nhắn riêng** để bot xử lý chính xác hơn.

### 5.3. Bot hiểu ngữ cảnh hội thoại

Bot có khả năng **nhớ ngữ cảnh** qua các tin nhắn trước đó trong cùng session.

#### Nhận diện đại từ tiếng Việt

Khi user dùng đại từ mơ hồ, bot sẽ tự **viết lại câu hỏi** thành câu hoàn chỉnh:

| Đại từ | Ví dụ gốc | Bot hiểu thành |
|--------|-----------|----------------|
| **nó** | "Nó giá bao nhiêu?" | "[Sản phẩm vừa nói] giá bao nhiêu?" |
| **cái đó** | "Cái đó còn hàng không?" | "[Sản phẩm vừa nói] còn hàng không?" |
| **cái này** | "Cái này có tốt không?" | "[Sản phẩm vừa nói] có tốt không?" |
| **loại này** | "Loại này có mấy size?" | "[Sản phẩm vừa nói] có mấy size?" |
| **món đó** | "Món đó bán chạy không?" | "[Sản phẩm vừa nói] bán chạy không?" |
| **sản phẩm đó** | "Sản phẩm đó của hãng nào?" | "[SP vừa nói] của hãng nào?" |
| **thế/vậy** | "Thế còn loại khác không?" | "Còn loại [tương tự SP vừa nói] khác không?" |

> ⚠️ **Quan trọng:** Tính năng này chỉ hoạt động khi có **lịch sử chat trước đó** trong cùng session. Nếu hỏi "nó" ngay tin nhắn đầu tiên, bot sẽ giữ nguyên câu gốc.

### 5.4. Cách viết câu hỏi hiệu quả nhất

```
❌ TRÁNH                              ✅ NÊN
─────────────────────────────────     ─────────────────────────────────
"Pepsi"                               "Pepsi giá bao nhiêu?"
"abc"                                 "Tìm nước giải khát abc"
"123"                                 "Đơn hàng #123 đến đâu?"
"mua gì"                              "Tư vấn nên mua gì làm quà?"
"còn không giá nhiêu"                 "Coca Cola còn hàng không?"
                                      "Coca Cola giá bao nhiêu?" (2 tin)
```

---

## 6. Ví dụ hội thoại thực tế

Dưới đây là các kịch bản sử dụng phổ biến, kèm **request/response cụ thể** để bạn dễ hình dung.

### 6.1. Kịch bản: Khách hàng được gợi ý sản phẩm (RAG Pipeline)

**Tình huống:** Khách VIP muốn mua đồ cho bữa tiệc BBQ.

```
👤 User:  "Tư vấn cho tôi bia nào ngon?"

🤖 Bot:   "Chào anh/chị (khách VIP)! Dưới đây là những loại bia phổ biến
           và phù hợp tại chi nhánh:

           1. 🍺 Bia Tiger 330ml — 15.000đ (còn 24 trên kệ)
           2. 🍺 Bia Heineken 330ml — 22.000đ (còn 18 trên kệ)
           3. 🍺 Tiger Crystal 330ml — 18.000đ (còn 12 trên kệ)
           4. 🍺 Bia Sapporo 330ml — 25.000đ (còn 10 trên kệ)
           5. 🍺 333 Export 330ml — 13.000đ (còn 36 trên kệ)

           💡 Khách mua Bia Tiger thường mua kèm: Đá viên, Khô mực.
           Anh/chị cần xem thêm hoặc cần gợi ý đồ nhậu không ạ?"
```

**API Response tương ứng:**
```json
{
  "success": true,
  "data": {
    "intent": "RECOMMENDATION",
    "reply": "Chào anh/chị (khách VIP)! Dưới đây là...",
    "products": [
      { "id": 42, "name": "Bia Tiger", "categoryName": "Đồ uống", "unitPrice": 15000, "quantityOnShelf": 24, "rrfScore": 0.0323 },
      { "id": 55, "name": "Bia Heineken", "categoryName": "Đồ uống", "unitPrice": 22000, "quantityOnShelf": 18, "rrfScore": 0.0301 }
    ],
    "metadata": {
      "model": "microsoft/Phi-3-mini-4k-instruct",
      "latencyMs": 1200,
      "ragMetadata": {
        "steps": {
          "reformulation": { "changed": false, "latencyMs": 2 },
          "embedding": { "latencyMs": 85 },
          "search": { "semanticCount": 8, "keywordCount": 5, "latencyMs": 45 },
          "fusion": { "totalCandidates": 10, "top5Scores": [{"productId": 42, "rrfScore": "0.0323"}] },
          "generation": { "latencyMs": 900 }
        },
        "totalLatencyMs": 1180
      }
    }
  }
}
```

> 📌 **Lưu ý:** Field `products` chỉ xuất hiện khi intent là `RECOMMENDATION` hoặc `SEARCH_PRODUCT`. Các intent khác trả `products: null`.

### 6.2. Kịch bản: Hỏi tiếp theo — Bot nhớ ngữ cảnh (Query Reformulation)

**Tình huống:** Sau khi bot gợi ý bia, khách hỏi tiếp dùng đại từ "nó".

```
👤 User:  "Nó còn hàng không?"          ← "nó" = Bia Tiger (từ context)

   🔄 Bot tự động viết lại: "Bia Tiger 330ml còn hàng không?"

🤖 Bot:   "Dạ, Bia Tiger 330ml hiện còn 24 sản phẩm trên kệ tại
           chi nhánh của anh/chị ạ! Anh/chị muốn mua bao nhiêu lon?"
```

```
👤 User:  "Cái đó đắt quá, có loại rẻ hơn không?"

   🔄 Bot tự động viết lại: "Bia Tiger 330ml đắt quá, có loại bia rẻ hơn không?"

🤖 Bot:   "Dạ, anh/chị có thể xem thêm:
           • 333 Export 330ml — 13.000đ (còn 36 lon)
           • Bia Hà Nội 330ml — 11.000đ (còn 42 lon)
           Hai loại này đều đang có sẵn tại chi nhánh ạ!"
```

```
👤 User:  "Vậy cho tôi xem giá cái đầu tiên"

   🔄 Bot tự động viết lại: "Cho tôi xem giá bia 333 Export 330ml"

🤖 Bot:   "Bia 333 Export 330ml:
           • Giá bán: 13.000đ/lon
           • Mua thùng 24 lon: 312.000đ"
```

### 6.3. Kịch bản: Nhân viên kiểm tra tồn kho

**Tình huống:** Nhân viên cần kiểm tra nhanh khi khách hỏi tại quầy.

```
👤 Employee:  "Kiểm tra tồn kho nước rửa tay Lifebuoy"

🤖 Bot:       "Nước rửa tay Lifebuoy 500ml (ID: 45):
               • Tổng tồn kho (On-hand): 50 sản phẩm
               • Trên kệ (On-shelf): 35 sản phẩm
               Sản phẩm đang có sẵn tại chi nhánh của bạn ạ."
```

**Khi sản phẩm hết hàng:**
```
👤 Employee:  "Mì Kokomi còn hàng không?"

🤖 Bot:       "Mì Kokomi 75g (ID: 89):
               • Tổng tồn kho: 0
               • Trên kệ: 0
               ⚠️ Sản phẩm hiện đã HẾT HÀNG tại chi nhánh.
               Bạn có muốn kiểm tra sản phẩm thay thế không?"
```

**Khi không tìm thấy sản phẩm:**
```
👤 Employee:  "XYZ-999 còn hàng không?"

🤖 Bot:       "Xin lỗi, mình không tìm thấy sản phẩm 'XYZ-999' trong
               hệ thống. Bạn có thể kiểm tra lại tên hoặc mã sản phẩm
               được không ạ?"
```

### 6.4. Kịch bản: Tra cứu đơn hàng theo mã

**Tình huống:** Khách muốn biết đơn hàng đã giao chưa.

```
👤 User:  "Đơn hàng #789 đến đâu rồi?"

🤖 Bot:   "Đơn hàng #789:
           • 🏷️ Trạng thái: Hoàn thành ✅
           • 💳 Thanh toán: Đã thanh toán
           • 💰 Tổng giá trị: 350.000đ
           Đơn hàng của bạn đã hoàn tất. Cảm ơn bạn đã mua sắm!"
```

**Khi không nhớ mã đơn — xem danh sách:**
```
👤 User:  "Kiểm tra đơn hàng"

🤖 Bot:   "Đây là 5 đơn hàng gần nhất của bạn:
           • #789: Hoàn thành | Đã thanh toán | 350.000đ
           • #785: Đang xử lý | Chờ thanh toán | 120.000đ
           • #780: Hoàn thành | Đã thanh toán | 89.000đ
           • #776: Đã hủy | Hoàn tiền | 200.000đ
           • #770: Hoàn thành | Đã thanh toán | 450.000đ
           Bạn muốn xem chi tiết đơn nào ạ?"
```

### 6.5. Kịch bản: So sánh giá nhiều sản phẩm

```
👤 User:  "Nước ngọt giá bao nhiêu?"

🤖 Bot:   "Dưới đây là giá một số nước ngọt hiện có:
           • Coca Cola 330ml: 12.000đ
           • Pepsi 330ml: 11.000đ
           • 7Up 330ml: 10.000đ
           • Fanta Cam 330ml: 11.000đ
           • Sprite 330ml: 10.000đ
           Anh/chị cần tìm thêm loại nào không ạ?"
```

### 6.6. Kịch bản: Trợ giúp — Xem menu chức năng

```
👤 User:  "Giúp tôi"

🤖 Bot:   "Xin chào! Tôi là POSMART Assistant. Tôi có thể giúp bạn:

           🔍 Kiểm tra tồn kho — Hỏi "Sản phẩm X còn hàng không?"
           💰 Kiểm tra giá — Hỏi "Giá sản phẩm Y bao nhiêu?"
           📦 Trạng thái đơn hàng — Hỏi "Đơn hàng #123 đến đâu rồi?"
           🛒 Tìm sản phẩm — Hỏi "Tìm sản phẩm giống nước rửa tay"
           💡 Gợi ý sản phẩm — Hỏi "Tư vấn nên mua gì làm quà?"
           💬 Trò chuyện — Hỏi bất cứ điều gì khác!

           Bạn cần giúp gì?"
```

### 6.7. Kịch bản: Trò chuyện tự do

```
👤 User:  "Xin chào, hôm nay trời nóng quá"

🤖 Bot:   "Chào bạn! Trời nóng thế này uống nước mát là nhất rồi 😊
           Bạn cần tìm nước giải khát gì không? Mình có thể gợi ý
           cho bạn những sản phẩm đang có tại cửa hàng!"
```

### 6.8. Kịch bản: Tìm kiếm sản phẩm bằng mô tả

**Tình huống:** Khách không nhớ tên chính xác, chỉ mô tả đại khái.

```
👤 User:  "Tìm loại sữa tắm thơm lâu"

🤖 Bot:   "Dưới đây là một số sữa tắm phổ biến tại chi nhánh:
           1. Sữa tắm Dove Dưỡng Ẩm 500ml — 95.000đ (còn 15)
           2. Sữa tắm Palmolive Hương Hoa 500ml — 78.000đ (còn 20)
           3. Sữa tắm Enchanteur 650ml — 110.000đ (còn 8)
           Anh/chị muốn xem chi tiết sản phẩm nào ạ?"
```

### 6.9. Kịch bản: Hội thoại hoàn chỉnh nhiều bước (Multi-turn)

**Tình huống:** Khách VIP cần mua đồ cho bữa tiệc, hỏi liên tiếp.

```
👤 User:  "Tư vấn đồ uống cho bữa tiệc 10 người"
🤖 Bot:   "Cho tiệc 10 người, mình gợi ý:
           1. Bia Tiger 330ml — 15.000đ/lon (mua 2 thùng = 720.000đ)
           2. Coca Cola 330ml — 12.000đ/lon (1 thùng = 288.000đ)
           3. Nước suối Aquafina 500ml — 5.000đ/chai (1 thùng = 120.000đ)
           Tổng ước tính: 1.128.000đ 💰"

👤 User:  "Cái đầu tiên có size lớn hơn không?"
   🔄 Reformulate: "Bia Tiger có size lớn hơn 330ml không?"
🤖 Bot:   "Có ạ! Bia Tiger có 2 size:
           • Tiger 330ml — 15.000đ/lon
           • Tiger 500ml — 20.000đ/lon (còn 30 lon)"

👤 User:  "Nó còn bao nhiêu?"
   🔄 Reformulate: "Bia Tiger 500ml còn bao nhiêu?"
🤖 Bot:   "Bia Tiger 500ml hiện còn 30 lon trên kệ ạ. Đủ cho tiệc
           10 người rồi! 🎉"

👤 User:  "OK cảm ơn!"
🤖 Bot:   "Không có gì ạ! Chúc anh/chị có bữa tiệc vui vẻ! 🎊
           Nếu cần thêm gì, cứ hỏi mình nhé."
```

### 6.10. Kịch bản: Khách sỉ (Wholesale) — Bot điều chỉnh gợi ý

```
👤 User (wholesale):  "Gợi ý bột giặt bán sỉ"

🤖 Bot:   "Chào anh/chị (khách sỉ)! Dưới đây là bột giặt phù hợp
           mua số lượng lớn:
           1. Omo Matic 6kg — 185.000đ (còn 40 bịch)
           2. Ariel 5.5kg — 175.000đ (còn 25 bịch)
           3. Surf 5.8kg — 145.000đ (còn 55 bịch)
           
           💼 Mua từ 10 bịch có thể liên hệ quầy để hỏi giá sỉ.
           Anh/chị cần đặt số lượng bao nhiêu ạ?"

---

## 7. Xử lý lỗi thường gặp

### 7.1. Lỗi 401 — Unauthorized

```json
{ "success": false, "error": { "message": "No token", "code": "UNAUTHORIZED" } }
```

**Nguyên nhân:** Token hết hạn hoặc thiếu header `Authorization`.
**Cách fix:** Đăng nhập lại để lấy token mới.

### 7.2. Lỗi 429 — Rate Limited

```json
{ "success": false, "error": { "message": "Too many chat requests. Please wait a moment.", "code": "RATE_LIMITED" } }
```

**Nguyên nhân:** Gửi quá 20 request/phút.
**Cách fix:** Chờ 60 giây rồi thử lại.

### 7.3. Bot trả lời "Xin lỗi, hệ thống đang gặp sự cố..."

**Nguyên nhân:** HuggingFace API đang quá tải hoặc model gặp lỗi.
**Cách fix:** Đợi vài giây rồi gửi lại. Bot sẽ trả lời dạng text thuần nếu AI tiếp tục lỗi.

### 7.4. WebSocket "UNAUTHORIZED: Token required"

**Nguyên nhân:** Thiếu token trong handshake auth.
**Cách fix:**
```javascript
// ❌ Sai
const socket = io('http://localhost:3008');

// ✅ Đúng
const socket = io('http://localhost:3008', {
  auth: { token: 'eyJhbGciOiJ...' }
});
```

### 7.5. Bot trả lời không đúng intent

**Nguyên nhân:** Tin nhắn không chứa keyword phù hợp.
**Cách fix:** Thêm keyword rõ ràng vào câu hỏi:
```
❌ "Pepsi"                          → FREE_CHAT
✅ "Pepsi giá bao nhiêu?"           → CHECK_PRICE
✅ "Tìm Pepsi"                      → SEARCH_PRODUCT
```

---

## 8. FAQ

### 💬 Cơ bản

**Q: Chatbot hỗ trợ ngôn ngữ nào?**

A: **Tiếng Việt** là ngôn ngữ chính. Bot được huấn luyện với model Vietnamese SBERT và Phi-3 Instruct. Nếu hỏi bằng tiếng Anh, bot sẽ cố trả lời bằng tiếng Anh nhưng độ chính xác tìm kiếm sản phẩm có thể giảm (do embedding model tối ưu cho tiếng Việt).

**Q: Chatbot có hoạt động offline không?**

A: **Một phần.** 
- ✅ Embedding (chuyển text thành vector) chạy **local trên CPU** — không cần internet.
- ❌ Sinh câu trả lời tự nhiên dùng **HuggingFace Cloud API** — cần internet.
- Nếu mất internet: Bot vẫn tìm được sản phẩm nhưng sẽ trả lời dạng danh sách thay vì câu văn tự nhiên.

**Q: Tôi cần hỗ trợ thêm?**

A: Gửi `giúp tôi` hoặc `hướng dẫn` trong chat để xem menu trợ giúp với đầy đủ ví dụ cho từng chức năng.

---

### 📊 Dữ liệu & Đồng bộ

**Q: Dữ liệu sản phẩm cập nhật như thế nào?**

A: Tự động qua **2 cơ chế song song**:

| Cơ chế | Độ trễ | Khi nào chạy |
|--------|--------|-------------|
| **Event-driven** (chính) | ~1-2 giây | Mỗi khi thêm/sửa/xóa sản phẩm, thay đổi tồn kho, hoặc có đơn hàng mới |
| **Cron full-sync** (backup) | Mỗi 30 phút | Đồng bộ toàn bộ catalog + inventory cho tất cả stores |

Dữ liệu được đồng bộ từ 3 service: **Catalog** (sản phẩm), **Inventory** (tồn kho), **Order** (đơn hàng → co-purchase).

**Q: Nếu thêm sản phẩm mới, bot có biết ngay không?**

A: **Có**, trong vòng 1-2 giây. Khi Catalog service publish event `product.created`, Chatbot tự động:
1. Nhận event qua RabbitMQ
2. Lấy thông tin inventory cho sản phẩm đó
3. Tạo embedding (chuyển thành vector 768 chiều)
4. Lưu vào knowledge base

Sau đó, sản phẩm mới sẽ xuất hiện trong kết quả tìm kiếm và gợi ý.

**Q: Bot có tìm thấy sản phẩm hết hàng không?**

A: **Không.** Bot chỉ tìm và gợi ý sản phẩm **đang còn hàng** (`is_in_stock = TRUE`). Sản phẩm hết hàng tự động bị loại khỏi kết quả tìm kiếm. Tuy nhiên, khi hỏi `CHECK_STOCK` cho sản phẩm cụ thể, bot vẫn thông báo rằng sản phẩm đó đã hết.

---

### 🔐 Session & Bảo mật

**Q: Session chat lưu được bao lâu?**

A: **Vĩnh viễn** trong database PostgreSQL. Mỗi session bao gồm toàn bộ lịch sử tin nhắn (user + bot), cùng metadata (intent, model, latency). Bạn có thể xem lại bất kỳ session nào qua:
```bash
GET /api/chat/sessions/:id
```

**Q: Nhân viên A có xem được chat của nhân viên B không?**

A: **Không.** Mỗi user chỉ xem được session của chính mình. API `GET /sessions` lọc theo `user_id` từ JWT token.

**Q: Token JWT hết hạn thì sao?**

A: REST API trả về `401 Unauthorized`. WebSocket sẽ bị ngắt kết nối với lỗi `UNAUTHORIZED: Invalid token`. Cần đăng nhập lại để lấy token mới.

---

### ⚡ Hiệu suất & Giới hạn

**Q: Có giới hạn tin nhắn không?**

A: 
| Giới hạn | Giá trị | Ghi chú |
|----------|---------|--------|
| Rate limit | **20 request/phút** | Áp dụng cho `/api/chat/*` |
| Tổng tin nhắn | **Không giới hạn** | Lưu vĩnh viễn trong DB |
| Độ dài tin nhắn | **Không giới hạn** | Nhưng nên < 500 ký tự để bot hiểu tốt |
| Tin nhắn trong context | **6-8 tin gần nhất** | Bot nhớ context từ nhiêu đó tin |

**Q: Bot phản hồi mất bao lâu?**

A: Tùy loại intent:

| Intent | Thời gian trung bình | Lý do |
|--------|---------------------|-------|
| `HELP` | < 10ms | Text tĩnh, không gọi AI |
| `CHECK_STOCK` | 500ms - 1.5s | API call + AI format |
| `CHECK_PRICE` | 400ms - 1s | API call + AI format |
| `ORDER_STATUS` | 400ms - 1s | API call + AI format |
| `SEARCH_PRODUCT` | 800ms - 2s | RAG pipeline (nếu có) |
| `RECOMMENDATION` | **1s - 3s** | Full RAG 7-step pipeline |
| `FREE_CHAT` | 500ms - 2s | AI generation only |

> 💡 Dùng WebSocket để hiển thị **typing indicator** trong lúc chờ bot xử lý.

**Q: Nếu AI phản hồi chậm hoặc lỗi, có ảnh hưởng đến hệ thống không?**

A: **Không.** Mỗi lỗi AI đều được xử lý graceful:
- LLM fail → Bot trả lời dạng danh sách sản phẩm thuần (không có văn phong tự nhiên)
- Embedding fail → Pipeline trả error message thân thiện
- API fail → Bot thông báo "hệ thống đang kết nối, vui lòng thử lại"

Không có trường hợp nào gây crash toàn service.

---

### 🎯 Trải nghiệm người dùng

**Q: Chatbot có nhớ ngữ cảnh hội thoại không?**

A: **Có**, qua 2 cơ chế:

1. **Chat history context:** Bot gửi 6-8 tin nhắn gần nhất vào AI model khi sinh câu trả lời → AI hiểu ngữ cảnh cuộc trò chuyện.

2. **Query Reformulation:** Khi phát hiện đại từ mơ hồ ("nó", "cái đó", "loại này"...), bot tự động dùng AI viết lại thành câu hoàn chỉnh trước khi tìm kiếm.

**Ví dụ cụ thể:**
```
Tin 1: "Bia Tiger giá bao nhiêu?"      → Bot trả lời về Tiger
Tin 2: "Nó còn hàng không?"             → Bot hiểu "nó" = Bia Tiger
Tin 3: "Cái đó có mấy size?"            → Bot hiểu "cái đó" = Bia Tiger
Tin 4: "Cho tôi xem sản phẩm khác"     → Không có đại từ, giữ nguyên
```

> ⚠️ **Giới hạn:** Bot chỉ nhớ trong **cùng 1 session**. Nếu tạo session mới, context sẽ reset.

**Q: Khách VIP có được đối xử khác không?**

A: **Có.** Bot tự động nhận diện loại khách từ hệ thống Auth và điều chỉnh gợi ý:

| Loại khách | Cách bot gợi ý |
|-----------|---------------|
| 🌟 **VIP** | Ưu tiên sản phẩm premium, thông báo giảm giá đặc biệt, lời chào riêng |
| 📦 **Wholesale (sỉ)** | Gợi ý số lượng lớn, nêu đơn vị thùng/lốc, nhắc liên hệ giá sỉ |
| 🛒 **Retail (lẻ)** | Gợi ý sản phẩm giá tốt, deal đang có, sản phẩm phổ thông |

**Q: Bot gợi ý "mua kèm" dựa trên đâu?**

A: Dựa trên **lịch sử mua hàng thực tế** của tất cả khách. Mỗi khi có đơn hàng hoàn thành (`order.completed`), hệ thống ghi nhận các cặp sản phẩm được mua cùng nhau. Cặp nào có frequency ≥ 3 lần sẽ xuất hiện trong gợi ý.

**Ví dụ:** Nếu nhiều khách mua "Bia Tiger" kèm "Đá viên" (≥ 3 đơn), bot sẽ gợi ý:
> "Khách mua Bia Tiger thường mua kèm: Đá viên, Khô mực."

**Q: Tôi có thể dùng Chatbot từ ứng dụng mobile không?**

A: **Có.** Chatbot hỗ trợ 2 giao thức:
- **REST API** — Dùng `fetch()` hoặc `axios` từ bất kỳ nền tảng nào
- **WebSocket** — Dùng thư viện `socket.io-client` (có cho React Native, Flutter, iOS, Android)

Chỉ cần truyền JWT token là có thể kết nối từ bất kỳ client nào.

**Q: Nếu nhiều nhân viên chat cùng lúc có bị chậm không?**

A: Mỗi session hoàn toàn **độc lập**. Nhân viên A chat không ảnh hưởng đến nhân viên B. Rate limit áp dụng **per-IP** (20 req/min), không phải global.

---

## Tài liệu liên quan

| Tài liệu | Mô tả |
|-----------|-------|
| [README.md](../../services/chatbot/README.md) | Tài liệu kỹ thuật chi tiết (API reference, env vars) |
| [Báo cáo đồ án](baocao-doan.md) | Báo cáo tổng quan kiến trúc (không code) |
| [Báo cáo kỹ thuật](bao-cao-chi-tiet-ky-thuat.md) | Giải thích chi tiết từng file code |
| [Implementation Plan](chatbot-rag-implementation-plan.md) | Kế hoạch triển khai 4 phases |
