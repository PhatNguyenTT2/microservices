# 📖 Hướng dẫn sử dụng Chatbot POSMART

> Tài liệu hướng dẫn chi tiết cho **nhân viên** và **khách hàng** sử dụng chatbot AI POSMART.
> Kèm test case cho từng tính năng.

---

## 1. Truy cập Chatbot

### Nhân viên (Employee)
1. Đăng nhập hệ thống POSMART bằng tài khoản nhân viên
2. Nhấn biểu tượng 💬 chatbot ở góc phải màn hình
3. Chatbot tự động nhận diện bạn là **nhân viên** → hiển thị data chi tiết

### Khách hàng (Customer)  
1. Đăng nhập/đăng ký tài khoản khách hàng
2. Nhấn biểu tượng 💬 chatbot
3. Chatbot tự động nhận diện bạn là **khách hàng** → phản hồi thân thiện, dễ hiểu

---

## 2. Chatbot có thể làm gì?

| # | Tính năng | Từ khóa kích hoạt | Vai trò |
|---|-----------|-------------------|---------|
| 1 | 🔍 Kiểm tra tồn kho | "tồn kho", "còn hàng", "còn không", "hết hàng", "có còn" | NV + KH |
| 2 | 💰 Kiểm tra giá | "giá", "bao nhiêu", "giá bán", "giá tiền" | NV + KH |
| 3 | 📦 Trạng thái đơn hàng | "đơn hàng", "order", "giao hàng", "trạng thái đơn", "đơn #" | NV + KH |
| 4 | 💡 Gợi ý sản phẩm | "gợi ý", "tư vấn", "nên mua", "mua gì", "có gì ngon" | NV + KH |
| 5 | 🔎 Tìm kiếm sản phẩm | "tìm", "search", "có gì", "sản phẩm nào" | NV + KH |
| 6 | ❓ Hướng dẫn | "help", "giúp", "hướng dẫn", "làm sao" | NV + KH |
| 7 | 💬 Trò chuyện tự do | Bất kỳ câu nào không khớp keyword trên | NV + KH |

---

## 3. Test Case chi tiết theo Intent

### 3.1 🔍 CHECK_STOCK — Kiểm tra tồn kho

**Mục đích**: Kiểm tra sản phẩm còn hàng hay không.

#### Từ khóa kích hoạt
`tồn kho`, `còn hàng`, `còn không`, `hết hàng`, `có còn`, `stock`, `inventory`, `số lượng còn`

#### Test Cases — Nhân viên

| # | Câu hỏi test | Kết quả mong đợi |
|---|-------------|-----------------|
| 1 | `sữa ông thọ còn hàng không` | ✅ Hiện ON-HAND, ON-SHELF, RESERVED, AVAILABLE |
| 2 | `tồn kho mì hảo hảo` | ✅ Hiện đầy đủ số liệu tồn kho nội bộ |
| 3 | `stock nước mắm nam ngư` | ✅ Phản hồi chuyên nghiệp, rõ ràng |
| 4 | `tồn kho abcxyz` | ⚠️ "Không tìm thấy sản phẩm" |

#### Test Cases — Khách hàng

| # | Câu hỏi test | Kết quả mong đợi |
|---|-------------|-----------------|
| 1 | `sữa ông thọ có còn không` | ✅ "Đang có X sản phẩm trên kệ" (CHỈ onShelf) |
| 2 | `nước mắm còn hàng không ạ` | ✅ Thân thiện + chỉ hiện thông tin đơn giản |
| 3 | `snack có còn không` | ✅ Tìm kiếm + hiện trạng thái hàng |

> **Khác biệt**: Nhân viên thấy on-hand/reserved/available. Khách hàng CHỈ thấy "còn X trên kệ" hoặc "tạm hết hàng".

---

### 3.2 💰 CHECK_PRICE — Kiểm tra giá

**Mục đích**: Tra giá sản phẩm.

#### Từ khóa kích hoạt
`giá`, `bao nhiêu`, `price`, `giá bán`, `giá tiền`, `chi phí`

#### Test Cases — Nhân viên

| # | Câu hỏi test | Kết quả mong đợi |
|---|-------------|-----------------|
| 1 | ` ` | ✅ Tên + giá + Product ID |
| 2 | `mì hảo hảo bao nhiêu` | ✅ Hiện giá chính xác |
| 3 | `giá bán nước rửa chén` | ✅ Danh sách (nếu nhiều kết quả) + ID |
| 4 | `giá tiền snack` | ✅ Danh sách SP khớp + giá |

#### Test Cases — Khách hàng

| # | Câu hỏi test | Kết quả mong đợi |
|---|-------------|-----------------|
| 1 | `giá sữa ông thọ` | ✅ Giá + "còn X trên kệ" (O2O) |
| 2 | `nước mắm nam ngư bao nhiêu` | ✅ Giá + tình trạng hàng + gợi ý mua kèm |
| 3 | `mì gói giá bao nhiêu` | ✅ Danh sách + Product Card trên frontend |
| 4 | `giá abcxyz` | ⚠️ "Không tìm thấy sản phẩm" |

> **Khác biệt**: Khách hàng thấy Product Card (tên, giá, ảnh, trạng thái hàng) + gợi ý mua kèm. Nhân viên thấy danh sách text + Product ID.

---

### 3.3 📦 ORDER_STATUS — Trạng thái đơn hàng

**Mục đích**: Kiểm tra trạng thái đơn hàng, thanh toán, chi tiết hóa đơn.

#### Từ khóa kích hoạt
`đơn hàng`, `order`, `tracking`, `giao hàng`, `trạng thái đơn`, `đơn #`, `mã đơn`

#### Trạng thái đơn hàng

| Status (DB) | Hiển thị tiếng Việt |
|-------------|-------------------|
| `draft` | Nháp |
| `shipping` | Đang giao |
| `delivered` | Đã giao |
| `cancelled` | Đã hủy |
| `refunded` | Đã hoàn tiền |

#### Trạng thái thanh toán

| Payment Status | Hiển thị tiếng Việt |
|---------------|-------------------|
| `pending` | Chờ thanh toán |
| `partial` | Thanh toán một phần |
| `paid` | Đã thanh toán |
| `failed` | Thanh toán thất bại |
| `refunded` | Đã hoàn tiền |
| `partial_refund` | Hoàn tiền một phần |

#### Test Cases — Nhân viên

| # | Câu hỏi test | Kết quả mong đợi |
|---|-------------|-----------------|
| 1 | `đơn hàng #1` | ✅ ORD-0001: Trạng thái + thanh toán + tổng tiền + shipping fee + discount + KH/NV ID + ngày + chi tiết items |
| 2 | `order 2` | ✅ Tương tự, nhận diện số `2` → tra đơn #2 |
| 3 | `trạng thái đơn #999` | ⚠️ "Không tìm thấy đơn hàng #999" |
| 4 | `đơn hàng gần đây` | ✅ Danh sách 5 đơn gần nhất (tất cả đơn của store) |
| 5 | `kiểm tra order` | ✅ Hiện 5 đơn gần nhất |

#### Test Cases — Khách hàng

| # | Câu hỏi test | Kết quả mong đợi |
|---|-------------|-----------------|
| 1 | `đơn hàng #1` | ✅ ORD-0001: Trạng thái + thanh toán + tổng tiền + địa chỉ giao (nếu delivery) + chi tiết items |
| 2 | `đơn hàng của tôi` | ✅ CHỈ hiện đơn hàng của chính khách đó |
| 3 | `order gần đây` | ✅ Danh sách đơn hàng cá nhân |

> **Khác biệt**: 
> - Nhân viên thấy **tất cả** đơn của store + ID nội bộ (customer_id, created_by)
> - Khách hàng chỉ thấy **đơn của mình** + thông tin thân thiện (không hiện ID nội bộ)

---

### 3.4 💡 RECOMMENDATION — Gợi ý sản phẩm (RAG AI)

**Mục đích**: Gợi ý sản phẩm thông minh dựa trên AI + vector search.

#### Từ khóa kích hoạt
`gợi ý`, `recommend`, `đề xuất`, `tư vấn`, `nên mua`, `mua gì`, `có gì ngon`, `giới thiệu`, `best seller`, `bán chạy`, `phổ biến`

#### Test Cases

| # | Câu hỏi test | Kết quả mong đợi |
|---|-------------|-----------------|
| 1 | `tư vấn nên mua gì làm quà` | ✅ AI gợi ý 3-5 SP phù hợp + giá + tồn kho |
| 2 | `có gì ngon giới thiệu đi` | ✅ Gợi ý sản phẩm ăn uống |
| 3 | `sản phẩm bán chạy nhất` | ✅ Top SP phổ biến |
| 4 | `gợi ý gia vị nấu ăn` | ✅ Tìm kiếm semantic → gợi ý gia vị |
| 5 | `mua gì cho bé` | ✅ AI hiểu ngữ cảnh → gợi ý SP trẻ em |
| 6 | `nên mua nước giặt nào` | ✅ So sánh + gợi ý các loại nước giặt |

> **Tính năng đặc biệt**: 
> - RAG Pipeline: Tìm kiếm vector (ngữ nghĩa) + keyword → Hybrid Search → RRF Fusion
> - Khách VIP/sỉ/lẻ nhận gợi ý khác nhau
> - Có gợi ý sản phẩm thường mua kèm (co-purchase)

---

### 3.5 🔎 SEARCH_PRODUCT — Tìm kiếm sản phẩm

**Mục đích**: Tìm sản phẩm theo tên, danh mục.

#### Từ khóa kích hoạt
`tìm`, `search`, `có gì`, `sản phẩm nào`, `loại nào`, `tìm kiếm`

#### Test Cases

| # | Câu hỏi test | Kết quả mong đợi |
|---|-------------|-----------------|
| 1 | `tìm sữa` | ✅ Danh sách SP chứa "sữa" + giá + trạng thái |
| 2 | `search nước mắm` | ✅ Tương tự, kết quả từ catalog |
| 3 | `có gì trong mục gia vị` | ✅ Tìm SP liên quan gia vị |
| 4 | `sản phẩm nào giống dầu gội` | ✅ Semantic search (RAG nếu có) |
| 5 | `tìm kiếm mì gói` | ✅ Danh sách mì gói |

> **Lưu ý**: Nếu RAG Service hoạt động → tìm kiếm ngữ nghĩa (hiểu "chất tẩy rửa" ≈ "nước rửa chén"). Nếu RAG tắt → tìm keyword thuần.

---

### 3.6 ❓ HELP — Hướng dẫn sử dụng

#### Từ khóa kích hoạt
`help`, `giúp`, `hướng dẫn`, `làm sao`, `cách`, `hỗ trợ`

#### Test Cases

| # | Câu hỏi test | Kết quả mong đợi |
|---|-------------|-----------------|
| 1 | `help` | ✅ Hiện menu trợ giúp đầy đủ |
| 2 | `hướng dẫn sử dụng` | ✅ Tương tự |
| 3 | `làm sao để kiểm tra giá` | ✅ Menu hướng dẫn |
| 4 | `hỗ trợ` | ✅ Menu hướng dẫn |

---

### 3.7 💬 FREE_CHAT — Trò chuyện tự do

**Mục đích**: Hỏi bất cứ điều gì không thuộc intent trên. AI trả lời tự do.

#### Test Cases

| # | Câu hỏi test | Kết quả mong đợi |
|---|-------------|-----------------|
| 1 | `xin chào` | ✅ AI chào lại thân thiện |
| 2 | `hôm nay thời tiết thế nào` | ✅ AI trả lời tự nhiên |
| 3 | `cảm ơn bạn nhé` | ✅ Phản hồi lịch sự |
| 4 | `bạn tên gì` | ✅ "Tôi là POSMART Assistant..." |

> **Lưu ý**: Streaming realtime — câu trả lời hiện từng chữ (không chờ toàn bộ).

---

## 4. Bảng so sánh trải nghiệm Employee vs Customer

| Tính năng | 👨‍💼 Nhân viên | 👤 Khách hàng |
|-----------|------------|-------------|
| **Tồn kho** | On-hand, On-shelf, Reserved, Available | Chỉ "còn X trên kệ" hoặc "hết hàng" |
| **Giá** | Giá + Product ID | Giá + tình trạng hàng + gợi ý mua kèm + Product Card |
| **Đơn hàng** | Tất cả đơn store + ID nội bộ | Chỉ đơn của mình + view thân thiện |
| **Gợi ý** | Kết quả RAG chuẩn | + Personalization (VIP/sỉ/lẻ) + co-purchase |
| **Giọng điệu** | Chuyên nghiệp, data-driven | Thân thiện, tư vấn bán hàng |

---

## 5. Mẹo sử dụng hiệu quả

### ✅ Nên
- Hỏi đúng tên sản phẩm: `"giá sữa ông thọ"` thay vì `"giá cái đấy"`
- Dùng mã đơn khi hỏi: `"đơn hàng #5"` thay vì `"đơn hàng của tôi"`
- Hỏi cụ thể: `"tồn kho nước mắm nam ngư"` thay vì `"còn hàng gì"`

### ❌ Không nên
- Hỏi quá nhiều sản phẩm cùng lúc
- Dùng từ viết tắt không phổ biến
- Kỳ vọng chatbot thực hiện thao tác (tạo đơn, thanh toán) — hiện chỉ hỗ trợ **tra cứu**

---

## 6. Xử lý lỗi thường gặp

| Tình huống | Nguyên nhân | Giải pháp |
|-----------|------------|----------|
| "Không tìm thấy sản phẩm" | Tên SP sai hoặc chưa có data | Thử tên khác, kiểm tra catalog |
| "Hệ thống đang bận" | AI model bị rate limit | Chờ 10-15 giây, thử lại |
| Chatbot không phản hồi | Mất kết nối WebSocket | Refresh trang, kiểm tra mạng |
| Response bằng tiếng Anh | AI model trả tiếng Anh | Hỏi lại bằng tiếng Việt rõ ràng hơn |
