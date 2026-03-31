# BÁO CÁO ĐỒ ÁN: MODULE CHATBOT AI SỬ DỤNG RAG
## Hệ thống Quản lý Chuỗi Siêu thị Mini — POSMART

---

## MỤC LỤC

1. [Yêu cầu nghiệp vụ](#1-yêu-cầu-nghiệp-vụ)
2. [Nền tảng lý thuyết](#2-nền-tảng-lý-thuyết)
3. [Giao tiếp với các service khác](#3-giao-tiếp-với-các-service-khác)
4. [Thiết kế cơ sở dữ liệu](#4-thiết-kế-cơ-sở-dữ-liệu)
5. [Pipeline xử lý dữ liệu cho RAG (Event-Driven)](#5-pipeline-xử-lý-dữ-liệu-cho-rag-event-driven)
6. [Luồng xử lý truy vấn RAG](#6-luồng-xử-lý-truy-vấn-rag)
7. [Các nghiệp vụ Chatbot xử lý](#7-các-nghiệp-vụ-chatbot-xử-lý)
8. [Tích hợp Multi-Tenancy](#8-tích-hợp-multi-tenancy)
9. [Mở rộng: Personalization và Recommendation nâng cao](#9-mở-rộng-personalization-và-recommendation-nâng-cao)

---

## 1. YÊU CẦU NGHIỆP VỤ

1. **Gợi ý sản phẩm theo ngữ nghĩa:** Hiểu ý định người dùng kể cả khi không dùng đúng tên sản phẩm.
2. **Chỉ gợi ý hàng còn trên kệ:** Lọc theo `is_in_stock = TRUE` và `store_id` cụ thể.
3. **Multi-tenancy:** Mỗi chi nhánh có tồn kho riêng. Kết quả gợi ý phải đúng chi nhánh mà khách đang chọn.
4. **Phản hồi tự nhiên bằng tiếng Việt:** Kết hợp dữ liệu thực với mô hình ngôn ngữ lớn (LLM) để sinh câu trả lời thân thiện.
5. **Đồng bộ dữ liệu gần real-time:** Sử dụng Event-Driven Sync (RabbitMQ) để cập nhật knowledge base ngay khi sản phẩm hoặc tồn kho thay đổi.
6. **Cá nhân hóa gợi ý:** Dựa trên loại khách hàng (VIP, sỉ, lẻ) và lịch sử mua hàng để điều chỉnh kết quả recommendation.

---

## 2. NỀN TẢNG LÝ THUYẾT

### 2.1 RAG — Retrieval-Augmented Generation

RAG là kỹ thuật kết hợp hai thành phần:

```mermaid
graph LR
    subgraph "Retrieval (Truy xuất)"
        Q["Câu hỏi"] --> EMB["Embedding Model"]
        EMB --> VS["Vector Search"]
        VS --> CTX["Top-K Documents"]
    end

    subgraph "Generation (Sinh văn bản)"
        CTX --> LLM["Large Language Model"]
        Q --> LLM
        LLM --> ANS["Câu trả lời"]
    end
```

- **Retrieval:** Chuyển câu hỏi thành vector, tìm kiếm các tài liệu có ngữ nghĩa gần nhất trong cơ sở tri thức.
- **Generation:** Đưa tài liệu tìm được vào prompt của LLM, giúp model sinh câu trả lời dựa trên **dữ liệu thực** thay vì chỉ dựa vào kiến thức huấn luyện.

**Ưu điểm RAG so với Fine-tuning:**
- Không cần huấn luyện lại mô hình khi dữ liệu thay đổi.
- Dữ liệu luôn cập nhật (qua pipeline đồng bộ).
- Chi phí thấp hơn đáng kể.

### 2.2 Vector Embedding và Cosine Similarity

**Embedding** là quá trình chuyển đổi văn bản thành vector số trong không gian nhiều chiều (768 chiều trong dự án này). Các văn bản có ngữ nghĩa tương tự sẽ có vector **gần nhau** trong không gian embedding.

**Cosine Similarity** đo độ tương đồng giữa hai vector:

```
similarity(A, B) = (A . B) / (||A|| x ||B||)
```

Giá trị từ -1 đến 1, trong đó 1 = hoàn toàn giống nhau.

### 2.3 pgvector và HNSW Index

**pgvector** là extension cho PostgreSQL hỗ trợ kiểu dữ liệu `VECTOR` và các phép toán vector search.

| Tham số | Giá trị trong dự án | Giải thích |
|---------|---------------------|------------|
| Dimension | 768 | Số chiều embedding (khớp với Vietnamese SBERT) |
| Distance metric | Cosine (`<=>`) | Phù hợp cho NLP embeddings đã normalize |
| Index type | **HNSW** | Hierarchical Navigable Small World — nhanh hơn IVFFlat cho dataset < 1M records |

### 2.4 Mô hình Embedding: Vietnamese SBERT

Dự án sử dụng `keepitreal/vietnamese-sbert` — mô hình Sentence-BERT được huấn luyện riêng cho tiếng Việt.

| Đặc điểm | Chi tiết |
|-----------|----------|
| Base model | PhoBERT |
| Output dimension | 768 |
| Ngôn ngữ | Tiếng Việt (tối ưu) |
| Runtime | `@xenova/transformers` (ONNX, chạy trên CPU) |
| Quantization | INT8 (giảm 4x kích thước, giữ 99% accuracy) |

### 2.5 Mô hình sinh văn bản: Phi-3-mini-4k-instruct

| Đặc điểm | Chi tiết |
|-----------|----------|
| Provider | Microsoft (via HuggingFace Inference API) |
| Parameters | 3.8B |
| Context window | 4096 tokens |
| Vai trò | Nhận dữ liệu sản phẩm từ RAG, sinh phản hồi tự nhiên |

---

## 3. GIAO TIẾP VỚI CÁC SERVICE KHÁC

Chatbot tương tác với các service qua **hai cơ chế**:

### 3.1 Event-Driven (RabbitMQ) — Đồng bộ dữ liệu

```mermaid
graph TB
    subgraph "Publishers"
        CAT["Catalog Service :3002"]
        INV["Inventory Service :3006"]
        ORD["Order Service :3003"]
    end

    subgraph "RabbitMQ (posmart.events)"
        EX{{"Topic Exchange"}}
    end

    subgraph "Subscriber"
        CB["Chatbot Service :3008"]
    end

    CAT -->|"product.created"| EX
    CAT -->|"product.updated"| EX
    CAT -->|"product.deleted"| EX
    INV -->|"inventory.updated"| EX
    INV -->|"stock.reserved"| EX
    INV -->|"stock.deducted"| EX
    ORD -->|"order.completed"| EX

    EX -->|"product.*"| CB
    EX -->|"inventory.*"| CB
    EX -->|"order.completed"| CB
```

| Event | Publisher | Xử lý tại Chatbot |
|-------|----------|-------------------|
| `product.created` | Catalog | Tạo record mới trong knowledge base, embed và lưu vector |
| `product.updated` | Catalog | Cập nhật content, re-embed vector |
| `product.deleted` | Catalog | Xóa record khỏi knowledge base |
| `inventory.updated` | Inventory | Cập nhật `is_in_stock`, `quantity_on_shelf` |
| `stock.deducted` | Inventory | Cập nhật số lượng tồn kho sau bán hàng |
| `order.completed` | Order | Ghi nhận co-purchase data (sản phẩm mua cùng nhau) |

### 3.2 HTTP Internal — Truy vấn theo yêu cầu

```mermaid
graph LR
    CB["Chatbot :3008"]

    CB -->|"GET /api/products/:id"| CAT["Catalog :3002"]
    CB -->|"GET /api/inventory/summary"| INV["Inventory :3006"]
    CB -->|"GET /api/orders/:id"| ORD["Order :3003"]
    CB -->|"GET /api/auth/customers/:id"| AUTH["Auth :3001"]
```

| Call | Mục đích | Khi nào |
|------|----------|---------|
| Catalog | Lấy chi tiết sản phẩm | User hỏi về sản phẩm cụ thể |
| Inventory | Lấy tồn kho real-time | User kiểm tra hàng còn không |
| Order | Tra cứu đơn hàng | User hỏi trạng thái đơn |
| Auth | Lấy thông tin khách hàng (customer_type, total_spent) | Personalization gợi ý |

---

## 4. THIẾT KẾ CƠ SỞ DỮ LIỆU

### 4.1 Sơ đồ ERD — chatbot_db

```mermaid
erDiagram
    CHAT_SESSION ||--o{ CHAT_MESSAGE : "contains"
    PRODUCT_KNOWLEDGE_BASE {
        bigint id PK
        bigint product_id "FK ref catalog_db.product"
        bigint store_id "FK ref auth_db.store"
        text content "Text formatted cho embedding"
        vector embedding "VECTOR(768)"
        text category_name "Cache danh mục"
        numeric unit_price "Cache giá bán"
        boolean is_in_stock "Metadata filter"
        int quantity_on_shelf "Số lượng trên kệ"
        timestamptz last_synced_at
    }

    CHAT_SESSION {
        bigint id PK
        bigint user_id "Ref auth_db.user_account"
        text user_type "customer hoặc employee"
        bigint store_id "Multi-tenancy context"
        bigint customer_id "Ref auth_db.customer (for personalization)"
        boolean is_active
        timestamptz started_at
    }

    CHAT_MESSAGE {
        bigint id PK
        bigint session_id FK
        text role "user, assistant, system"
        text content
        text intent "RECOMMENDATION, CHECK_STOCK..."
        jsonb metadata "model, latencyMs, productIds"
    }

    CO_PURCHASE_STATS {
        bigint id PK
        bigint product_id_a "Sản phẩm gốc"
        bigint product_id_b "Sản phẩm mua kèm"
        bigint store_id "Per-store statistics"
        int co_purchase_count "Số lần mua cùng"
        timestamptz last_updated_at
    }

    PROCESSED_EVENTS {
        text event_id PK
        text event_type
        timestamptz processed_at
    }
```

### 4.2 Chi tiết bảng product_knowledge_base

Bảng trung tâm của hệ thống RAG, lưu trữ embedding vector cho mỗi sản phẩm tại mỗi chi nhánh.

**Thiết kế SQL:**

```sql
CREATE TABLE product_knowledge_base (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    product_id BIGINT NOT NULL,
    store_id BIGINT NOT NULL,
    content TEXT NOT NULL,
    embedding VECTOR(768),
    category_name TEXT,
    unit_price NUMERIC DEFAULT 0,
    is_in_stock BOOLEAN DEFAULT TRUE,
    quantity_on_shelf INT DEFAULT 0,
    last_synced_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (product_id, store_id)
);
```

**Chiến lược Index:**

| Index | Kiểu | Mục đích |
|-------|------|----------|
| `idx_pkb_embedding` | HNSW (`vector_cosine_ops`) | Tăng tốc vector similarity search |
| `idx_pkb_store_stock` | B-Tree (partial: `WHERE is_in_stock = TRUE`) | Tối ưu metadata filtering theo store + tồn kho |
| `idx_pkb_product_store` | B-Tree | Tối ưu UPSERT khi đồng bộ dữ liệu |

### 4.3 Bảng co_purchase_stats (Recommendation nâng cao)

Lưu trữ thống kê "sản phẩm thường mua cùng nhau", được cập nhật từ event `order.completed`:

```sql
CREATE TABLE co_purchase_stats (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    product_id_a BIGINT NOT NULL,
    product_id_b BIGINT NOT NULL,
    store_id BIGINT NOT NULL,
    co_purchase_count INT DEFAULT 1,
    last_updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (product_id_a, product_id_b, store_id)
);

CREATE INDEX idx_copurchase_lookup
    ON co_purchase_stats(product_id_a, store_id)
    WHERE co_purchase_count >= 3;
```

Khi có event `order.completed` chứa nhiều sản phẩm, hệ thống sẽ:
1. Lấy danh sách sản phẩm trong đơn hàng.
2. Tạo tất cả các cặp (A, B) và UPSERT vào `co_purchase_stats`.
3. Khi gợi ý sản phẩm, kết hợp Top-K vector search với co-purchase data.

### 4.4 Cột content — Template cho Embedding

Cột `content` lưu trữ văn bản đã được format theo mẫu chuẩn, dùng làm đầu vào cho embedding model:

```
Sản phẩm "Coca Cola", danh mục "Nước giải khát", giá 12.000 VND,
nhà cung cấp "Coca-Cola Vietnam", hiện còn 48 sản phẩm trên kệ.
```

Mẫu này được thiết kế **tối ưu cho Vietnamese SBERT** vì:
- Sử dụng ngôn ngữ tự nhiên tiếng Việt thay vì key-value.
- Bao gồm cả ngữ cảnh (danh mục, giá, tình trạng) giúp embedding nắm bắt đa chiều thông tin.
- Khi user hỏi "nước ngọt giá rẻ", embedding sẽ gần với các record có content chứa "nước giải khát" + giá thấp.

---

## 5. PIPELINE XỬ LÝ DỮ LIỆU CHO RAG (EVENT-DRIVEN)

### 5.1 Tổng quan Pipeline

```mermaid
graph TB
    subgraph "Nguồn Event (Gần real-time)"
        E1["product.created / updated"]
        E2["inventory.updated"]
        E3["order.completed"]
    end

    subgraph "Chatbot Service — Event Handlers"
        H1["ProductEventHandler"]
        H2["InventoryEventHandler"]
        H3["OrderEventHandler"]
    end

    subgraph "Xử lý"
        MERGE["Merge và Format Content"]
        EMB["Vietnamese SBERT (Embedding)"]
        COPURCH["Phân tích Co-purchase"]
    end

    subgraph "chatbot_db"
        KB[("product_knowledge_base")]
        CP[("co_purchase_stats")]
        PE[("processed_events")]
    end

    E1 -->|RabbitMQ| H1
    E2 -->|RabbitMQ| H2
    E3 -->|RabbitMQ| H3

    H1 --> MERGE
    H2 --> MERGE
    MERGE --> EMB
    EMB -->|vector 768d| KB

    H3 --> COPURCH
    COPURCH --> CP

    H1 & H2 & H3 -->|kiểm tra idempotency| PE
```

### 5.2 Cơ chế đồng bộ: Event-Driven Sync

Hệ thống sử dụng **Event-Driven Sync** qua RabbitMQ làm cơ chế đồng bộ chính:

```
┌─────────────────────────────────────────────────────────────┐
│  EVENT-DRIVEN SYNC (gần real-time)                          │
│                                                             │
│  Khi Catalog thay đổi sản phẩm:                            │
│    1. Catalog publish event (product.created/updated)       │
│    2. Chatbot nhận event qua RabbitMQ                       │
│    3. Kiểm tra idempotency (processed_events)               │
│    4. Lấy inventory data cho sản phẩm đó                   │
│    5. Format content → Embed → UPSERT knowledge base       │
│                                                             │
│  Khi Inventory thay đổi tồn kho:                            │
│    1. Inventory publish event (inventory.updated)           │
│    2. Chatbot cập nhật is_in_stock, quantity_on_shelf       │
│    3. Re-embed nếu content thay đổi đáng kể                │
│                                                             │
│  Khi Đơn hàng hoàn thành:                                   │
│    1. Order publish event (order.completed)                 │
│    2. Chatbot phân tích cặp sản phẩm trong đơn             │
│    3. UPSERT co_purchase_stats                              │
│                                                             │
│  FALLBACK: Cron */30 * * * * full-sync để xử lý            │
│            trường hợp mất event hoặc service restart        │
└─────────────────────────────────────────────────────────────┘
```

**Lý do chọn Event-Driven Sync làm cơ chế chính:**
- Đồng bộ gần real-time — khách luôn thấy sản phẩm mới nhất.
- Phù hợp với kiến trúc Microservices hiện tại (đã có RabbitMQ).
- Chỉ xử lý sản phẩm thay đổi, không cần full-scan toàn bộ catalog.
- Fallback cron 30 phút đảm bảo tính nhất quán nếu mất event.

### 5.3 Xử lý giá sản phẩm

Hệ thống có **hai mức giá**:
- **Catalog** (`product.unit_price`): Giá niêm yết toàn chuỗi.
- **Inventory** (`product_batch.unit_price`): Giá bán thực tế tại từng chi nhánh (có thể khác).

Pipeline ưu tiên lấy giá từ Inventory (nếu có), fallback về giá Catalog.

---

## 6. LUỒNG XỬ LÝ TRUY VẤN RAG

### 6.1 Sequence Diagram hoàn chỉnh

```mermaid
sequenceDiagram
    actor User as Người dùng
    participant FE as Frontend
    participant CS as ChatService
    participant IR as IntentResolver
    participant RAG as RAGService
    participant EMB as EmbeddingClient
    participant KB as KnowledgeBase (pgvector)
    participant CP as CoPurchaseStats
    participant LLM as HuggingFace LLM

    User->>FE: "Gợi ý mình vài loại bia ngon"
    FE->>CS: sendMessage(sessionId, message)

    Note over CS: Bước 1: Phân loại ý định
    CS->>IR: resolveIntent(message)
    IR-->>CS: intent = RECOMMENDATION

    CS->>CS: Lấy store_id + customer_id từ chat_session
    CS->>RAG: recommend(message, storeId, customerId)

    Note over RAG: Bước 2: Embedding câu hỏi
    RAG->>EMB: embed("Gợi ý mình vài loại bia ngon")
    EMB-->>RAG: query_vector [768 chiều]

    Note over RAG,KB: Bước 3: Vector Search + Metadata Filtering
    RAG->>KB: searchSimilar(vector, storeId, inStockOnly=true)
    Note over KB: WHERE store_id = 1<br/>AND is_in_stock = TRUE<br/>ORDER BY embedding <=> query_vector<br/>LIMIT 5
    KB-->>RAG: Top 5 sản phẩm phù hợp

    Note over RAG,CP: Bước 3.5: Co-purchase Enrichment
    RAG->>CP: getCoPurchaseProducts(topProductIds, storeId)
    CP-->>RAG: Sản phẩm thường mua kèm

    Note over RAG,LLM: Bước 4: Personalized Augmented Generation
    RAG->>RAG: Build context (products + co-purchase + customer profile)
    RAG->>LLM: System prompt + Product data + Customer context + User question
    LLM-->>RAG: Câu trả lời tự nhiên, cá nhân hóa

    RAG-->>CS: { content, productIds, products }
    CS-->>FE: Response + productIds
    FE-->>User: Hiển thị câu trả lời + thẻ sản phẩm
```

### 6.2 Giải thích từng bước

**Bước 1 — Intent Resolution:**
Hệ thống keyword matching quét message tìm các từ khóa như "gợi ý", "recommend", "tư vấn", "nên mua gì", "có gì ngon"... Khi phát hiện, classify intent = `RECOMMENDATION` và chuyển sang RAGService.

**Bước 2 — Query Embedding:**
Câu hỏi của user được chuyển thành vector 768 chiều bằng Vietnamese SBERT. Mô hình chạy **local trên CPU** thông qua ONNX Runtime (thư viện `@xenova/transformers`), không cần GPU hay gọi API bên ngoài.

**Bước 3 — Vector Search với Metadata Filtering:**
Truy vấn pgvector kết hợp:
- **Vector similarity:** `ORDER BY embedding <=> query_vector` (cosine distance)
- **Metadata filter:** `WHERE store_id = X AND is_in_stock = TRUE`
- **Top-K:** `LIMIT 5` (trả về 5 sản phẩm gần nhất)

Đây là điểm mạnh cốt lõi: kết quả luôn **đúng chi nhánh** và **chỉ hàng còn trên kệ**.

**Bước 3.5 — Co-purchase Enrichment:**
Sau khi có Top-5 sản phẩm, hệ thống truy vấn `co_purchase_stats` để tìm sản phẩm thường mua kèm. Ví dụ: Tìm thấy Bia Tiger → Thêm gợi ý "Đá viên" và "Khô bò" (thường mua cùng).

**Bước 4 — Personalized Augmented Generation:**
Dữ liệu Top-5 sản phẩm + co-purchase + thông tin khách hàng (customer_type, total_spent) được format thành context, ghép vào prompt gửi cho LLM. LLM sinh câu trả lời tự nhiên, cá nhân hóa theo từng khách.

---

## 7. CÁC NGHIỆP VỤ CHATBOT XỬ LÝ

### 7.1 Bảng Intent — Phân loại ý định

| Intent | Từ khóa kích hoạt | Handler | Nguồn dữ liệu | Phương thức |
|--------|-------------------|---------|---------------|-------------|
| **RECOMMENDATION** | gợi ý, recommend, tư vấn, nên mua, có gì ngon | `_handleRecommendation()` | knowledge_base + co_purchase_stats + customer profile | **RAG** (vector search + personalization + LLM) |
| **CHECK_STOCK** | tồn kho, còn hàng, hết hàng, có còn | `_handleCheckStock()` | Catalog API, Inventory API | HTTP internal |
| **CHECK_PRICE** | giá, bao nhiêu, giá bán | `_handleCheckPrice()` | Catalog API (top 5 kết quả) | HTTP internal |
| **ORDER_STATUS** | đơn hàng, order, tracking, mã đơn | `_handleOrderStatus()` | Order API (by ID) | HTTP internal |
| **SEARCH_PRODUCT** | tìm, search, sản phẩm nào | `_handleSearchProduct()` | Catalog API (`ILIKE`) | HTTP internal |
| **HELP** | help, giúp, hướng dẫn | `_handleHelp()` | Static text | Local |
| **FREE_CHAT** | *(fallback)* | `_handleFreeChat()` | HuggingFace LLM | LLM only |

### 7.2 Ví dụ tương tác theo từng nghiệp vụ

#### Nghiệp vụ 1: Gợi ý sản phẩm (RAG + Personalization)

**Khách VIP (total_spent > 5M):**
```
User: "Tối nay muốn nướng BBQ, gợi ý đồ uống đi kèm nhé"
Bot: "Chào anh! Là khách VIP, em gợi ý một số đồ uống premium cho buổi BBQ:
    1. Bia Heineken Silver (22.000đ/lon) — còn 18 lon
    2. Bia Tiger Crystal (18.000đ/lon) — còn 30 lon
    3. Coca-Cola Zero (15.000đ/lon) — còn 24 lon
    Anh được giảm 5% cho đơn từ 200.000đ trở lên!
    Tip: Khách mua bia thường mua kèm Đá viên và Khô bò nữa đó anh!"
```

**Khách lẻ:**
```
User: "Có gì ngon giá rẻ không?"
Bot: "Chào bạn! Hôm nay mình có một số sản phẩm giá tốt:
    1. Mì Hảo Hảo (4.500đ/gói) — còn 120 gói
    2. Nước suối Aquafina (5.000đ/chai) — còn 48 chai
    3. Bánh mì sandwich (12.000đ) — còn 15 cái
    Các sản phẩm này đều đang có mặt tại chi nhánh của bạn!"
```

**Điểm khác biệt:** Khách VIP được gợi ý sản phẩm premium + thông tin giảm giá. Khách lẻ được gợi ý sản phẩm giá tốt.

#### Nghiệp vụ 2: Kiểm tra tồn kho

```
User: "Sữa TH True Milk còn không?"
Bot: "Sữa TH True Milk 1L hiện còn 12 hộp trên kệ tại chi nhánh của bạn."
```

#### Nghiệp vụ 3: Tra cứu đơn hàng

```
User: "Kiểm tra đơn hàng #5 giúp tôi"
Bot: "Đơn hàng ORD-0005:
    - Trạng thái: Đã giao
    - Thanh toán: Đã thanh toán
    - Tổng tiền: 245.000đ"
```

### 7.3 So sánh SEARCH_PRODUCT cũ vs RECOMMENDATION mới

| Tiêu chí | SEARCH_PRODUCT (cũ) | RECOMMENDATION (RAG + Personalization) |
|----------|---------------------|----------------------------------------|
| Thuật toán | `ILIKE '%keyword%'` (text match) | Vector Cosine Similarity |
| Hiểu ngữ nghĩa | Chỉ khớp chuỗi | Hiểu synonym, ngữ cảnh |
| Lọc tồn kho | Không lọc | `is_in_stock = TRUE` |
| Lọc chi nhánh | Không lọc | `store_id` filtering |
| Ranking | Không xếp hạng | Theo similarity score |
| Co-purchase | Không có | "Thường mua kèm: ..." |
| Cá nhân hóa | Không có | VIP/sỉ/lẻ → gợi ý khác nhau |
| Đồng bộ dữ liệu | Real-time API call | Event-driven (gần real-time) |
| Augmentation | Raw data cho LLM | Context-enriched + customer profile cho LLM |

---

## 8. TÍCH HỢP MULTI-TENANCY

### 8.1 Luồng xác định store_id

```mermaid
graph LR
    A["User đăng nhập"] --> B["JWT chứa storeId"]
    B --> C["Tạo chat_session<br/>lưu store_id + customer_id"]
    C --> D["Mỗi query RAG<br/>lọc WHERE store_id = ?"]
```

1. Khi user đăng nhập, JWT token chứa `storeId` (chi nhánh mà user thuộc về hoặc đang chọn).
2. Khi tạo phiên chat mới, `store_id` và `customer_id` được lưu vào bảng `chat_session`.
3. Mọi truy vấn RAG sẽ tự động lọc `WHERE store_id = X`, đảm bảo kết quả chỉ bao gồm sản phẩm tại chi nhánh đó.

### 8.2 Ví dụ minh họa

Sản phẩm "Bia Tiger" có 2 records trong `product_knowledge_base`:

| product_id | store_id | is_in_stock | quantity_on_shelf |
|-----------|----------|-------------|-------------------|
| 42 | 1 (Chi nhánh A) | TRUE | 24 |
| 42 | 2 (Chi nhánh B) | FALSE | 0 |

Khi khách hàng tại chi nhánh B hỏi "Gợi ý bia", hệ thống sẽ **không gợi ý Bia Tiger** vì `is_in_stock = FALSE` tại `store_id = 2`.

---

## 9. MỞ RỘNG: PERSONALIZATION VÀ RECOMMENDATION NÂNG CAO

### 9.1 Personalization — Cá nhân hóa gợi ý

#### Nguồn dữ liệu cá nhân hóa

| Dữ liệu | Service | Bảng/Field | Mục đích |
|---------|---------|-----------|----------|
| Loại khách hàng | Auth :3001 | `customer.customer_type` | Phân biệt VIP / sỉ / lẻ |
| Tổng chi tiêu | Auth :3001 | `customer.total_spent` | Xác định mức VIP |
| Chiết khấu theo loại | Settings :3004 | `sales_settings.discount_vip/wholesale/retail` | Thông báo khuyến mãi |

#### Logic Personalization

```mermaid
graph TD
    START["Nhận customer_id từ chat_session"] --> FETCH["Lấy customer profile từ Auth"]
    FETCH --> CLASSIFY{"Phân loại khách"}

    CLASSIFY -->|"customer_type = vip<br/>total_spent > 5M"| VIP["GỢI Ý PREMIUM<br/>Sản phẩm giá cao<br/>+ Thông báo giảm giá VIP"]

    CLASSIFY -->|"customer_type = wholesale"| WHOLESALE["GỢI Ý SỈ<br/>Sản phẩm số lượng lớn<br/>+ Giá sỉ"]

    CLASSIFY -->|"customer_type = retail<br/>(default)"| RETAIL["GỢI Ý LẺ<br/>Sản phẩm giá tốt<br/>+ Deal/khuyến mãi"]

    VIP --> INJECT["Thêm context vào RAG prompt"]
    WHOLESALE --> INJECT
    RETAIL --> INJECT
    INJECT --> LLM["LLM sinh câu trả lời cá nhân hóa"]
```

**Prompt template cho từng loại khách:**

| Loại khách | Prompt bổ sung |
|-----------|----------------|
| **VIP** | "Khách hàng VIP, ưu tiên gợi ý sản phẩm chất lượng cao. Thông báo giảm {discount_vip}% cho đơn từ 200.000đ." |
| **Wholesale** | "Khách sỉ, ưu tiên sản phẩm số lượng lớn, giá sỉ. Gợi ý đơn vị thùng/lốc thay vì lẻ." |
| **Retail** | "Khách lẻ, ưu tiên sản phẩm giá tốt, deal hôm nay. Gợi ý sản phẩm phổ thông." |

### 9.2 Co-purchase Recommendation — Gợi ý mua kèm

#### Nguồn dữ liệu

Phân tích `sale_order_detail` từ event `order.completed`. Khi một đơn hàng chứa nhiều sản phẩm, hệ thống tạo các cặp (A, B) và đếm tần suất xuất hiện.

#### Logic xử lý event `order.completed`

```
Khi nhận event order.completed:
  1. Lấy danh sách sản phẩm trong đơn: [Bia Tiger, Đá viên, Khô bò]
  2. Tạo tất cả các cặp:
     - (Bia Tiger, Đá viên), (Bia Tiger, Khô bò), (Đá viên, Khô bò)
  3. UPSERT vào co_purchase_stats:
     - (Bia Tiger, Đá viên, store_id=1) → count += 1
     - (Bia Tiger, Khô bò, store_id=1) → count += 1
     - (Đá viên, Khô bò, store_id=1) → count += 1
```

#### Truy vấn Co-purchase khi gợi ý

```sql
-- Tìm sản phẩm thường mua cùng product X
SELECT product_id_b, co_purchase_count
FROM co_purchase_stats
WHERE product_id_a = $1
  AND store_id = $2
  AND co_purchase_count >= 3
ORDER BY co_purchase_count DESC
LIMIT 3;
```

#### Ví dụ kết quả

```
Khách hỏi: "Gợi ý bia ngon"

RAG kết quả:
  1. Bia Tiger (15.000đ) — similarity: 92%
  2. Bia Heineken (22.000đ) — similarity: 88%

Co-purchase enrichment:
  "Khách mua Bia Tiger thường mua kèm:
   - Đá viên (85% đơn hàng)
   - Khô bò (62% đơn hàng)
   - Hạt điều (41% đơn hàng)"

LLM sinh ra:
  "Chào bạn! Mình gợi ý:
   1. Bia Tiger (15.000đ/lon) — còn 24 lon
   2. Bia Heineken (22.000đ/lon) — còn 18 lon
   Tip: Khách mua bia thường lấy thêm Đá viên và Khô bò nữa đó bạn!"
```

### 9.3 Tổng hợp luồng Recommendation hoàn chỉnh

```mermaid
graph TB
    subgraph "Input"
        MSG["Tin nhắn người dùng"]
        SID["store_id (từ session)"]
        CID["customer_id (từ session)"]
    end

    subgraph "Layer 1: Semantic Search"
        EMB["Vietnamese SBERT<br/>Embed câu hỏi"]
        VS["pgvector Search<br/>Top-5 + store_id filter"]
    end

    subgraph "Layer 2: Co-purchase"
        CP["co_purchase_stats<br/>Sản phẩm thường mua kèm"]
    end

    subgraph "Layer 3: Personalization"
        PROFILE["Customer Profile<br/>(type, total_spent)"]
        DISC["Discount Rules<br/>(settings)"]
    end

    subgraph "Layer 4: Generation"
        CTX["Context Builder<br/>Products + Co-purchase + Profile"]
        LLM["Phi-3-mini LLM<br/>Sinh phản hồi tự nhiên"]
    end

    subgraph "Output"
        RESP["Câu trả lời cá nhân hóa<br/>+ Product IDs cho UI"]
    end

    MSG --> EMB
    EMB --> VS
    SID --> VS

    VS --> CP
    VS --> CTX

    CID --> PROFILE
    PROFILE --> CTX
    DISC --> CTX
    CP --> CTX

    CTX --> LLM
    LLM --> RESP
```

**4 tầng xử lý:**
1. **Semantic Search:** Tìm sản phẩm phù hợp với ngữ nghĩa câu hỏi + lọc store_id + is_in_stock.
2. **Co-purchase:** Bổ sung sản phẩm thường mua kèm, tăng giá trị đơn hàng.
3. **Personalization:** Điều chỉnh gợi ý theo loại khách hàng, thông báo khuyến mãi phù hợp.
4. **Generation:** LLM tổng hợp tất cả thông tin thành câu trả lời tự nhiên.

---

## TÀI LIỆU THAM KHẢO KỸ THUẬT

| Tài liệu | Đường dẫn |
|----------|-----------|
| Kế hoạch triển khai chi tiết | `docs/chatbot/chatbot-rag-implementation-plan.md` |
| Sơ đồ thiết kế hệ thống tổng thể | `docs/system-design-diagrams.md` |
| Schema SQL tổng hợp | `supabase_init_all.sql` |
| Event types | `shared/event-bus/eventTypes.js` |
