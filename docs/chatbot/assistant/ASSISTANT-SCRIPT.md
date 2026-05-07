# SCRIPT THUYẾT TRÌNH: CHATBOT ASSISTANT — TRỢ LÝ THAO TÁC

> Thời lượng ước tính: 8-10 phút
> Kết hợp demo trực tiếp

---

## I. Giới thiệu vấn đề (1 phút)

"Kính thưa Hội đồng, chatbot POSMART hiện tại hoạt động ở chế độ **chỉ đọc** — tra cứu tồn kho, giá, đơn hàng và gợi ý sản phẩm. Tuy nhiên, khi khách hàng thấy gợi ý một sản phẩm hấp dẫn, họ phải **rời khỏi chatbot**, tìm lại sản phẩm đó trên trang web, rồi mới thêm vào giỏ được."

"Tương tự, nhân viên POS muốn lập đơn nhanh cho khách quen cũng phải thao tác thủ công trên giao diện. Điều này tạo ra **ma sát trải nghiệm (UX Friction)** — mỗi bước rời khỏi chatbot là một cơ hội để mất khách hàng."

**Slide**: So sánh 2 luồng:
```
Hiện tại (6 bước):  Hỏi chatbot → Xem gợi ý → Đóng chat → Tìm SP → Thêm giỏ → Checkout
Mới (3 bước):       Hỏi chatbot → "Thêm vào giỏ" → Checkout
```

---

## II. Giải pháp: Action Assistant Protocol (2 phút)

"Em đề xuất nâng cấp chatbot thành **Trợ lý thao tác (Action Assistant)**, có khả năng **write** vào hệ thống thông qua một giao thức mới gọi là **Action Protocol**."

### 2.1 Nguyên tắc cốt lõi

| # | Nguyên tắc | Giải thích |
|---|---|---|
| 1 | **Confirmation Protocol** | Mọi write action phải được xác nhận trước khi thực thi |
| 2 | **Data from API, Text from LLM** | AI chỉ format câu trả lời, dữ liệu luôn đến từ API thật |
| 3 | **Least Privilege** | Chatbot chỉ có quyền tối thiểu cho từng role |
| 4 | **Audit Trail** | Mọi thao tác write được ghi log đầy đủ |

### 2.2 Action Response Protocol

"Khi chatbot phát hiện intent thao tác (write intent), ngoài `fullText` và `products`, response còn chứa thêm trường `action` — chỉ thị cho frontend biết phải làm gì."

```json
{
  "intent": "ADD_TO_CART",
  "fullText": "Đã thêm Sữa Ông Thọ vào giỏ!",
  "action": {
    "type": "ADD_TO_CART",
    "payload": { "productId": 1, "quantity": 2 }
  }
}
```

"Frontend nhận `action` → gọi `CartContext.addToCart()` → giỏ hàng cập nhật ngay lập tức, người dùng không cần rời chatbot."

---

## III. Customer Assistant — Trải nghiệm khách hàng (2 phút)

### 3.1 Thêm vào giỏ hàng (ADD_TO_CART)

"Khách hàng có thể nói: *'Thêm 2 sữa ông thọ vào giỏ'*"

**Demo flow**:
```
KH: "thêm 2 sữa ông thọ vào giỏ"
CB: [RAG resolve] → Sữa Ông Thọ (ID: 1, Giá: 35,000đ)
    [Check stock] → Còn 80 trên kệ ✅
    → "✅ Đã thêm 2 Sữa Ông Thọ (70,000đ) vào giỏ!"
    → action: ADD_TO_CART → CartContext tự cập nhật
```

"Điểm quan trọng: chatbot **không gọi API tạo đơn**. Việc thêm giỏ hàng được xử lý hoàn toàn ở **client-side** (CartContext), giống hệt như khi khách bấm nút 'Thêm vào giỏ' trên trang web."

### 3.2 Quản lý giỏ hàng 2 chiều (Bi-directional Cart)

"Trong thực tế, khách hàng rất hay đổi ý. Hệ thống hỗ trợ đầy đủ thao tác giỏ hàng:"

```
KH: "Thôi bỏ hộp sữa ra đi"
CB: → REMOVE_FROM_CART → action: removeFromCart(productId: 1)
    → "✅ Đã bỏ Sữa Ông Thọ khỏi giỏ."

KH: "Giảm xuống còn 1 hộp thôi"
CB: → UPDATE_CART_ITEM → action: updateQuantity(productId: 1, qty: 1)
    → "✅ Đã cập nhật: 1 hộp."
```

### 3.3 Hiểu đại từ chỉ định (Contextual Pronoun Resolution)

"Một điểm quan trọng: trong hội thoại tự nhiên, khách hàng thường **không gõ lại tên sản phẩm**."

```
CB: "Mình có Ba chỉ bò Mỹ giá 125,000đ, còn 15 trên kệ."
KH: "Ok, thêm cái đó vào giỏ đi"
CB: → Không tìm thấy tên SP trong câu
    → Tra session.lastMentionedProducts → Ba chỉ bò Mỹ (ID: 5)
    → "✅ Đã thêm Ba chỉ bò Mỹ vào giỏ!"
```

"Em lưu `lastMentionedProducts` trong session metadata. Mỗi khi chatbot gợi ý hoặc tra cứu sản phẩm, danh sách này tự động cập nhật — giúp AI hiểu 'cái đó', 'lấy 2 hộp' đang nói về sản phẩm nào."

### 3.4 Hủy đơn hàng (Customer CANCEL_ORDER)

```
KH: "Hủy cho tôi đơn số 5"
CB: → Ownership check: đơn của chính KH này? ✅
    → Status check: draft (chưa giao)? ✅
    → "Bạn chắc chắn muốn hủy đơn ORD-0005 (125,500đ) không?"
KH: "Ừ, hủy đi"
CB: → Confirmation Gate ✅ → PATCH /orders/5/status → cancelled
    → "✅ Đã hủy đơn ORD-0005."
```

### 3.5 Theo dõi đơn hàng (TRACK_ORDER)

```
KH: "Đơn hàng #5 giao tới đâu rồi?"
CB: → Kiểm tra ownership (đơn của chính KH này) ✅
    → "Đơn ORD-0005: Đang giao 🚚
       Đặt lúc: 06/05 | Thanh toán: VNPay ✅ | Tổng: 250,000đ"
    → action: NAVIGATE → /order-status/5
```

### 3.6 Hướng dẫn thanh toán (CHECKOUT_GUIDE)

```
KH: "Thanh toán đi"
CB: → "Giỏ hàng hiện có 3 sản phẩm, tổng 185,000đ.
       Nhấn nút bên dưới để tiến hành thanh toán!"
    → action: NAVIGATE → /checkout
```

---

## IV. Employee Assistant — Trợ lý POS (2 phút)

### 4.1 Thêm sản phẩm vào POS (POS_ADD_ITEM)

"Nhân viên bán hàng có thể nói: *'Thêm 3 mì hảo hảo'* — chatbot tự động resolve sản phẩm và thêm vào giỏ POS."

### 4.2 Lập đơn hàng (CREATE_ORDER — Multi-turn)

"Đây là tính năng phức tạp nhất, yêu cầu **hội thoại nhiều vòng (Multi-turn)**."

```
NV: "Lập đơn cho khách Nguyễn Văn An"
CB: "Tìm thấy KH: Nguyễn Văn An (VIP). Thêm sản phẩm gì?"
    [State: COLLECTING]

NV: "2 thùng sữa ông thọ, 1 gói mì"
CB: "Xác nhận đơn:
     1. Sữa Ông Thọ x2 — 120,000đ
     2. Mì Hảo Hảo x1 — 5,500đ
     Tổng: 125,500đ. Xác nhận tạo?"
    [State: CONFIRMING]

NV: "OK tạo đi"
CB: → POST /api/orders → ORD-0042 created
    "✅ Đã tạo đơn ORD-0042. Tổng: 125,500đ"
    [State: IDLE]
```

"Em sử dụng **State Machine** lưu trong `chat_session.metadata` (JSONB) với auto-expire sau 5 phút không tương tác."

### 4.3 Kiểm tra thanh toán (PAYMENT_CHECK)

```
NV: "Đơn #42 thanh toán chưa?"
CB: "ORD-0042: Chờ thanh toán (pending). Tổng: 125,500đ."
```

---

## V. Bảo mật — 7 lớp bảo vệ (1 phút)

"Khi chatbot có khả năng **write**, bảo mật trở nên cực kỳ quan trọng. Em thiết kế **7 lớp bảo vệ**:"

| Lớp | Tên | Mô tả |
|---|---|---|
| 1 | Intent Classification | Phân loại intent chính xác |
| 2 | Permission Check | Kiểm tra quyền theo role (Employee vs Customer) |
| 3 | Ownership Check | Customer chỉ thao tác đơn của mình |
| 4 | Status Validation | Chỉ cancel draft/shipping, chỉ update draft |
| 5 | **Confirmation Gate** | **Bắt buộc xác nhận trước mọi write** |
| 6 | Audit Log | Ghi lại user_id + action + data + session_id |
| 7 | Rate Limiting | Tối đa 5 write actions / session / 5 phút |

"Đặc biệt, Lớp 5 (Confirmation Gate) đảm bảo rằng ngay cả khi AI hiểu sai intent, hệ thống vẫn **không thực thi** cho đến khi người dùng xác nhận rõ ràng."

---

## VI. Kiến trúc kỹ thuật (1 phút)

"Về mặt kỹ thuật, em cần thay đổi tối thiểu:"

| Component | Hiện tại | Sau nâng cấp |
|---|---|---|
| **IntentResolver** | 7 read intents | 15 intents (+8 write) |
| **ChatService** | Single-turn handlers | +Multi-turn state machine + Pronoun Resolution |
| **ApiClient** | 8 read methods | +5 write methods |
| **WebSocket** | 5 events | +2 events (confirm, action) |
| **Frontend** | Text + Product Card | +Action buttons + Cart 2 chiều |

"Điểm hay là: **Backend APIs cho Order, Payment, Inventory đã có sẵn**. Chatbot chỉ cần gọi qua ApiClient, không cần tạo API mới."

---

## VII. So sánh trước/sau (1 phút)

| Tiêu chí | v1.2 (Read-only) | v2.0 (Assistant) |
|---|---|---|
| Chế độ | Chỉ tra cứu | Tra cứu + Thao tác |
| Trải nghiệm KH | "Xem rồi tự tìm mua" | "Xem → Thêm/Bỏ giỏ → Hủy đơn → Checkout" |
| Trải nghiệm NV | "Tra cứu rồi thao tác thủ công" | "Nói → Chatbot làm → Xác nhận" |
| Cart Management | Không | 2 chiều (Add/Remove/Update) |
| Pronoun Resolution | Không | ✅ "cái đó", "lấy 2 hộp" |
| Conversation | 1 vòng (Q&A) | Nhiều vòng (State Machine) |
| Bảo mật | JWT auth | 7 lớp (Permission → Audit) |

"Mục tiêu cuối cùng: biến chatbot từ **công cụ tra cứu** thành **nhân viên ảo** thực thụ."

---

## VIII. Kết luận

"Với thiết kế Action Protocol và 7 lớp bảo mật, chatbot POSMART v2.0 sẽ trở thành một trợ lý thực sự — không chỉ trả lời câu hỏi mà còn **hành động** theo yêu cầu người dùng, giảm ma sát trải nghiệm và tăng tỷ lệ chuyển đổi."
