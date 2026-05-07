# KỊCH BẢN THUYẾT TRÌNH BẢO VỆ ĐỒ ÁN — CHATBOT ASSISTANT

> **Dự kiến**: 10-12 phút

---

## I. Mở đầu & Đặt vấn đề (2 phút)

"Kính thưa Hội đồng,

Ở phần trước, em đã trình bày hệ thống **Gợi ý sản phẩm AI** với kiến trúc Hybrid Ensemble — giúp chatbot có khả năng tra cứu, tìm kiếm và gợi ý sản phẩm thông minh. Tuy nhiên, chatbot hiện tại chỉ dừng lại ở mức **chỉ đọc (read-only)**.

Vấn đề thực tế là: khi chatbot gợi ý một sản phẩm hấp dẫn, khách hàng phải **rời khỏi giao diện chat**, tìm lại sản phẩm trên trang web, rồi mới thêm vào giỏ được. Mỗi bước rời khỏi chatbot là một cơ hội để **mất khách hàng**."

**Slide**: So sánh 2 luồng:

| | Hiện tại (6 bước) | Đề xuất (3 bước) |
|---|---|---|
| 1 | Hỏi chatbot | Hỏi chatbot |
| 2 | Xem gợi ý | "Thêm vào giỏ" |
| 3 | Đóng chat | Checkout ✅ |
| 4 | Tìm SP trên web | — |
| 5 | Thêm giỏ | — |
| 6 | Checkout | — |

"Em đề xuất nâng cấp chatbot thành **Trợ lý thao tác (Action Assistant)** — không chỉ trả lời câu hỏi mà còn **hành động** theo yêu cầu người dùng."

---

## II. Giải pháp: Action Protocol (2 phút)

### 2.1 Ý tưởng cốt lõi

"Bài toán mấu chốt là: làm sao để chatbot ở **backend** can thiệp vào giỏ hàng ở **frontend** mà không phá vỡ kiến trúc?

Em thiết kế giao thức **Action Protocol**: chatbot không trực tiếp thao tác giỏ hàng, mà trả về một **chỉ thị hành động (action)** kèm theo câu trả lời. Frontend nhận chỉ thị này và tự thực thi."

**Slide**: Sơ đồ Action Protocol:
```
User: "Thêm sữa vào giỏ"
    ↓
Chatbot Service: Intent → ADD_TO_CART → RAG resolve → Check stock
    ↓
Response: { text: "Đã thêm!", action: { type: ADD_TO_CART, payload: {id, qty} } }
    ↓
Frontend: CartContext.addToCart(payload) → Giỏ hàng cập nhật ✅
```

"Kiến trúc này đảm bảo backend hoàn toàn **stateless** — không cần biết giỏ hàng đang có gì. Cùng một protocol hoạt động trên cả Customer Web lẫn POS."

### 2.2 Nguyên tắc thiết kế

| # | Nguyên tắc | Giải thích |
|---|---|---|
| 1 | **Confirmation Protocol** | Mọi thao tác thay đổi dữ liệu phải được xác nhận |
| 2 | **Data from API, Text from LLM** | AI chỉ soạn câu trả lời, dữ liệu luôn từ API thật |
| 3 | **Least Privilege** | Chatbot chỉ có quyền tối thiểu cho từng role |
| 4 | **Audit Trail** | Mọi thao tác write được ghi log đầy đủ |

---

## III. Khả năng mới cho Khách hàng (3 phút)

"Hệ thống mở rộng từ 7 lên **15 intents**, thêm 8 thao tác mới."

### 3.1 Thêm vào giỏ hàng

```
KH: "Thêm 2 sữa ông thọ vào giỏ"
CB: → RAG resolve "sữa ông thọ" → Sữa Ông Thọ (35,000đ)
    → Kiểm tra tồn kho: còn 80 ✅
    → "✅ Đã thêm 2 Sữa Ông Thọ (70,000đ) vào giỏ!"
    → action: ADD_TO_CART → Frontend tự cập nhật CartContext
```

### 3.2 Quản lý giỏ hàng 2 chiều

"Trong thực tế, khách hàng rất hay đổi ý. Hệ thống hỗ trợ **đầy đủ vòng đời giỏ hàng** — không chỉ thêm mà còn xóa và sửa:"

```
KH: "Thôi bỏ hộp sữa ra đi"         → REMOVE_FROM_CART
KH: "Giảm xuống còn 1 hộp thôi"      → UPDATE_CART_ITEM
KH: "Xóa hết giỏ hàng đi"           → REMOVE_FROM_CART (clear all)
```

### 3.3 Hiểu đại từ chỉ định

"Một điểm quan trọng: trong hội thoại tự nhiên, khách thường **không gõ lại tên sản phẩm**."

```
CB: "Mình có Ba chỉ bò Mỹ giá 125,000đ, còn 15 trên kệ."
KH: "Ok, thêm cái đó vào giỏ đi"
CB: → Không tìm thấy tên SP trong câu
    → Tra session.lastMentionedProducts → Ba chỉ bò Mỹ
    → "✅ Đã thêm Ba chỉ bò Mỹ vào giỏ!"
```

"Em lưu `lastMentionedProducts` trong session metadata. Mỗi khi chatbot gợi ý hoặc tra cứu sản phẩm, danh sách này tự động cập nhật — giúp hệ thống hiểu *'cái đó'*, *'lấy 2 hộp'* đang nói về sản phẩm nào."

### 3.4 Hủy đơn hàng

"Khách hàng cũng có thể tự hủy đơn hàng **của chính mình** qua chatbot:"

```
KH: "Hủy cho tôi đơn số 5"
CB: → Kiểm tra quyền sở hữu: đơn của KH này? ✅
    → Kiểm tra trạng thái: draft (chưa giao)? ✅
    → "Bạn chắc chắn muốn hủy ORD-0005 (125,500đ)?"
KH: "Ừ, hủy đi"
CB: → Xác nhận ✅ → API cancel → "✅ Đã hủy đơn ORD-0005."
```

"Lưu ý: nếu đơn đã giao, chatbot sẽ từ chối và hướng dẫn liên hệ nhân viên."

---

## IV. Khả năng mới cho Nhân viên POS (2 phút)

### 4.1 Thêm sản phẩm vào POS

"Nhân viên nói: *'Thêm 3 mì hảo hảo'* — chatbot tự RAG resolve và thêm vào giỏ POS."

### 4.2 Lập đơn hàng — Hội thoại nhiều vòng

"Đây là tính năng phức tạp nhất, sử dụng **State Machine** cho hội thoại nhiều vòng:"

| Lượt | Vai | Nội dung | Trạng thái |
|---|---|---|---|
| 1 | NV | "Lập đơn cho khách Nguyễn Văn An" | → COLLECTING |
| 2 | CB | "Tìm thấy KH (VIP). Thêm SP gì?" | COLLECTING |
| 3 | NV | "2 thùng sữa, 1 gói mì" | COLLECTING |
| 4 | CB | "Sữa ×2 + Mì ×1 = 125,500đ. Tạo?" | → CONFIRMING |
| 5 | NV | "OK tạo đi" | → EXECUTED |
| 6 | CB | "✅ Đã tạo ORD-0042." | → IDLE |

"Trạng thái được lưu trong session metadata (JSONB), tự động hết hạn sau 5 phút không tương tác."

### 4.3 Kiểm tra thanh toán

```
NV: "Đơn #42 thanh toán chưa?"
CB: "ORD-0042: Chờ thanh toán (pending). Tổng: 125,500đ."
```

---

## V. Bảo mật — 7 lớp bảo vệ (1 phút)

"Khi chatbot có khả năng **write**, bảo mật trở nên cực kỳ quan trọng. Em thiết kế **7 lớp bảo vệ chồng lên nhau (Defense in Depth)**:"

| Lớp | Tên | Vai trò |
|---|---|---|
| 1 | Intent Classification | Phân loại ý định chính xác |
| 2 | Permission Check | Kiểm tra quyền theo role |
| 3 | Ownership Check | Khách chỉ thao tác đơn của mình |
| 4 | Status Validation | Chỉ hủy được draft/shipping |
| 5 | **Confirmation Gate** | **Bắt buộc xác nhận trước mọi write** |
| 6 | Audit Log | Ghi log mọi thao tác |
| 7 | Rate Limiting | Tối đa 5 writes / 5 phút |

"Lớp 5 — Confirmation Gate — là lớp then chốt nhất. Ngay cả khi AI hiểu sai ý định, hệ thống **không bao giờ thực thi** cho đến khi người dùng xác nhận rõ ràng."

---

## VI. So sánh trước và sau (1 phút)

| Tiêu chí | v1.2 (Read-only) | v2.0 (Assistant) |
|---|---|---|
| Chế độ | Chỉ tra cứu | Tra cứu + Thao tác |
| Trải nghiệm KH | Xem → tự tìm mua | Xem → Thêm/Bỏ giỏ → Checkout |
| Trải nghiệm NV | Tra cứu → thao tác tay | Nói → Chatbot làm → Xác nhận |
| Cart | Không | 2 chiều (Add/Remove/Update) |
| Pronoun Resolution | Không | ✅ "cái đó", "lấy 2 hộp" |
| Conversation | 1 vòng | Nhiều vòng (State Machine) |
| Bảo mật | JWT | 7 lớp Defense in Depth |

---

## VII. Kết luận (30 giây)

"Chatbot Action Assistant biến hệ thống từ **công cụ tra cứu thụ động** thành **trợ lý thao tác chủ động**. Với Action Protocol, backend hoàn toàn độc lập khỏi frontend state. Với 7 lớp bảo mật và Confirmation Gate, mọi thao tác write đều an toàn và có kiểm soát.

Hệ thống giảm UX Friction từ 6 bước xuống 3 bước, tăng tỷ lệ chuyển đổi và giảm tải cho nhân viên — đưa chatbot POSMART lên ngang tầm một giải pháp **Conversational Commerce** thực thụ."
