# Kịch bản Kiểm thử Thuật toán Chatbot (Algorithm Testcases)

> **Mục tiêu:** Kiểm chứng độ chính xác của 3 pipeline thuật toán cốt lõi trong hệ thống Chatbot (Semantic Search, Apriori, Personalization).
> **Điều kiện tiên quyết:** Đã chạy file `seed.sql` (60 products) và script `mock-orders.js` (500 đơn hàng giả lập).

---

## 1. Testcase: Trích xuất Ngữ nghĩa (Semantic Search / RAG)

**Mục đích:** Đảm bảo pgvector và mô hình nhúng (Embedding) bắt được các từ khóa đồng nghĩa, khác bối cảnh mà không cần match exact keyword.

* **TC 1.1: Tìm kiếm theo bối cảnh ẩm thực**
    * **Input Chatbot:** *"Tôi đang nấu ăn, cần mua ít đồ nêm nếm cho đậm vị."*
    * **Expected Output:** Chatbot trả về Hạt nêm Knorr (ID 52), Bột ngọt Ajinomoto (ID 53), Nước mắm (ID 49, 50).
    * **Pass Criteria:** Không trả về các sản phẩm không liên quan. Điểm `cosine_similarity` > 0.75.

* **TC 1.2: Tìm kiếm theo cảm xúc / thời tiết**
    * **Input Chatbot:** *"Trời nóng quá, có đồ giải khát mùa hè nào mát lạnh không?"*
    * **Expected Output:** Chatbot trả về Nước ngọt Coca-Cola (ID 19), Bia Heineken (ID 17), Trà Ô Long (ID 40).

---

## 2. Testcase: Khai phá Luật kết hợp (Apriori Co-purchase)

**Mục đích:** Kiểm tra xem hệ thống có tính toán đúng chỉ số `Support` và `Confidence` từ lịch sử đơn hàng để gợi ý chéo (Cross-sell) hay không.

* **TC 2.1: Kích hoạt cụm "Lẩu Bò"**
    * **Input Action:** User thêm **Ba chỉ bò (ID 1)** và **Nấm kim châm (ID 2)** vào giỏ hàng và hỏi *"Tôi cần mua thêm gì để ăn kèm không?"*.
    * **Expected Output:** Chatbot tự động truy vấn `co_purchase_stats` và gợi ý: Gia vị lẩu Thái (ID 4), Rau muống (ID 3), Bún tươi (ID 5).
    * **Pass Criteria:** Thuật toán tính ra `Confidence(ID1, ID2 -> ID4) > 60%`. Không gợi ý các loại thịt khác (như Thịt heo ID 27).

* **TC 2.2: Kích hoạt cụm "Bữa Sáng"**
    * **Input Action:** User đang xem chi tiết sản phẩm **Bánh mì Sandwich (ID 7)**.
    * **Expected Output:** Chatbot chủ động popup (hoặc hiển thị ở mục "Thường mua cùng"): Lốc sữa Vinamilk (ID 8), Trứng gà (ID 10), Xúc xích (ID 11).

---

## 3. Testcase: Cá nhân hóa Phân khúc (Role-Based Context Injection)

**Mục đích:** Đảm bảo Prompt Injection hoạt động đúng, ép LLM phản hồi theo các policy khác nhau dựa trên Role của token.

* **TC 3.1: Luồng Khách hàng Bán lẻ (Retail)**
    * **Pre-condition:** Đăng nhập tài khoản Customer (Role: `retail`).
    * **Input Chatbot:** *"Cho tôi xem các loại gạo ST25 và Sữa tươi."*
    * **Expected Output:** Gợi ý Gạo ST25 túi 5kg (ID 42) và Lốc 4 hộp Sữa (ID 8). Tone giọng thân thiện, báo giá lẻ.

* **TC 3.2: Luồng Khách hàng Đại lý / Mua sỉ (Wholesale)**
    * **Pre-condition:** Đăng nhập tài khoản Đối tác (Role: `wholesale`).
    * **Input Chatbot:** *"Cho tôi xem các loại gạo ST25 và Sữa tươi."*
    * **Expected Output:** Gợi ý Bao gạo 25kg (ID 43) và Thùng 48 hộp Sữa (ID 9). 
    * **Pass Criteria:** Cùng 1 input nhưng LLM bóc tách ra các SKU khác nhau. Có kèm câu chào mời ưu đãi chiết khấu số lượng lớn.