# KẾ HOẠCH TRIỂN KHAI ADVANCED RAG CHATBOT
**Dự án:** POSMART (Hệ thống Siêu thị mini)
**Phiên bản:** v2 — Advanced Retrieval (Hybrid Search + RRF + Event-Driven)

---

## 1. MỤC TIÊU NÂNG CẤP

Áp dụng các kỹ thuật Advanced RAG để khắc phục nhược điểm của Vector Search thuần túy:
- **Tỷ lệ chính xác 99%:** Kết hợp tìm kiếm ngữ nghĩa và tìm kiếm từ khóa chính xác (Mã SKU, tên không dấu).
- **Trí nhớ hội thoại:** Chatbot hiểu được các đại từ nhân xưng và câu hỏi nối tiếp.
- **Đồng bộ gần real-time:** Event-driven sync từ Catalog/Inventory/Order qua RabbitMQ.
- **Cá nhân hóa:** Gợi ý theo loại khách (VIP / sỉ / lẻ) + sản phẩm mua kèm.
- **Tối ưu chi phí:** Embedding local (SBERT) + LLM API (Phi-3).

---

## 2. LỘ TRÌNH TRIỂN KHAI CHI TIẾT

### PHASE 1: Nền tảng Dữ liệu Đa phương thức (Ingestion Pipeline)
*Cấu trúc lại dữ liệu trong PostgreSQL + Event-driven sync.*

* **Task 1.1: Nâng cấp Schema `product_knowledge_base`**
    * Giữ nguyên cột `embedding VECTOR(768)` (Cho SBERT).
    * Thêm cột `fts_content TSVECTOR` (Cho Keyword Search bản địa của PostgreSQL).
    * Tạo index `GIN` cho `fts_content` và giữ index `HNSW` cho `embedding`.
    * Tạo bảng `co_purchase_stats` + `processed_events`.
* **Task 1.2: Tối ưu Content Template cho SBERT (Max ~256 tokens)**
    * Đảm bảo `content` chứa các câu ngắn gọn, giàu ngữ nghĩa tiếng Việt.
    * Bổ sung "Từ khóa:" cho keyword search.
    * *Ví dụ:* "Sản phẩm Bia Tiger lon 330ml, danh mục đồ uống có cồn, giá 15.000đ. Từ khóa: bia tiger, tiger beer, lon 330ml."
* **Task 1.3: Data Ingestion — Event-Driven + Cron Fallback**
    * **Primary:** Subscribe events `product.*`, `inventory.updated`, `order.completed` qua RabbitMQ.
    * **Fallback:** Cron full-sync mỗi 30 phút cho trường hợp mất event hoặc restart.
    * Lưu đồng thời `embedding` (vector) + `fts_content` (tsvector).
* **Task 1.4: Cross-Service Event Publishing**
    * Catalog Service: Thêm publish `product.created/updated/deleted/price_changed` qua repository pattern.
    * Inventory Service: Thêm publish `inventory.updated` sau deduct/reserve/release.

### PHASE 2: Cỗ máy Truy xuất Thông minh (Advanced Retrieval)
*Xây dựng trái tim của hệ thống: Hybrid Search + RRF.*

* **Task 2.1: Query Reformulation (Tái cấu trúc câu hỏi)**
    * Kiểm tra lịch sử chat. Nếu có đại từ ("nó", "cái đó"), gọi Phi-3 dịch câu hỏi nối tiếp thành câu độc lập.
    * VD: "Nó còn hạn sử dụng bao lâu?" → "Bia Tiger 330ml còn hạn sử dụng bao lâu?"
* **Task 2.2: Triển khai Hybrid Search trên PostgreSQL**
    * Viết dual-search trong KnowledgeRepository (đều lọc theo `store_id` và `is_in_stock = TRUE`).
    * Luồng 1: Tìm theo Cosine Similarity (`<=>`) — pgvector.
    * Luồng 2: Tìm theo Full-text Search (`@@ plainto_tsquery`) — tsvector.
    * Chạy **song song** với `Promise.all()`.
* **Task 2.3: Thuật toán Reciprocal Rank Fusion (RRF)**
    * Cài đặt logic RRF tại Node.js để trộn 2 danh sách kết quả.
    * Công thức: `RRF(d) = SUM(1 / (60 + rank(d)))`
    * Lấy ra Top 5 sản phẩm có điểm RRF cao nhất.

### PHASE 3: Cá nhân hóa & Sinh câu trả lời (Augmented Generation)
*Bơm dữ liệu cá nhân + co-purchase vào Prompt cho LLM.*

* **Task 3.1: Co-purchase Enrichment (Bổ sung hàng mua kèm)**
    * Xử lý event `order.completed` → đếm tần suất cặp sản phẩm mua cùng.
    * Query `co_purchase_stats` cho Top 5 sản phẩm từ Phase 2.
* **Task 3.2: Personalized Context Builder**
    * Query thông tin khách hàng từ Auth Service (customer_type, total_spent).
    * Inject rules: VIP → premium + giảm giá | Sỉ → số lượng lớn | Lẻ → deal.
* **Task 3.3: Format Prompt chuẩn cho Phi-3-instruct**
    * System prompt: "Bạn là nhân viên tư vấn POSMART. Chỉ tiếng Việt. Chỉ dùng dữ liệu cung cấp."
    * Timeout 10s. Fallback: trả text cứng kèm thẻ UI sản phẩm.

### PHASE 4: Tích hợp & Kiểm thử (Integration & QA)
* **Task 4.1: Tích hợp Intent Resolver**
    * Thêm intent RECOMMENDATION trước SEARCH_PRODUCT.
    * Chỉ gọi RAG Pipeline khi intent = RECOMMENDATION.
* **Task 4.2: ChatService + index.js Bootstrap**
    * Inject RAGService vào ChatService.
    * Bootstrap event subscriptions + cron fallback trong index.js.
* **Task 4.3: WebSocket + REST Endpoints**
    * WebSocket response bổ sung `productIds` + `products`.
    * REST: `GET /rag/status`, `POST /rag/sync`.
* **Task 4.4: Testing**
    * Store isolation: Hỏi tại store A → không thấy sản phẩm store B.
    * Khách VIP: LLM có nhắc giảm giá.
    * Hybrid Search: "tiger" tìm chính xác, "bia ngon" tìm ngữ nghĩa.

---

## 3. TIMELINE

| Ngày | Tasks | Deliverable |
|------|-------|-------------|
| 1-2 | Phase 1 | Schema + Event sync + Embedding model |
| 3-4 | Phase 2 | Hybrid Search + RRF + Query Reform |
| 5 | Phase 3 | Co-purchase + Personalization |
| 6-7 | Phase 4 | Tích hợp + Full testing |

---
*Tài liệu chi tiết: `docs/chatbot/chatbot-rag-implementation-plan.md`*
*Thiết kế riêng cho kiến trúc Microservices Node.js/PostgreSQL.*