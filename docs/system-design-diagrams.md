# SƠ ĐỒ THIẾT KẾ HỆ THỐNG — POSMART
## Hệ thống Quản lý Chuỗi Siêu thị Mini (Microservices & Multi-tenancy)

**Dự án:** POSMART — Online-to-Offline (O2O) Mini-Mart Management System  
**Kiến trúc:** Microservices + Event-Driven + Saga Pattern  
**Ngày tạo:** 2026-03-31

---

## 1. SƠ ĐỒ KIẾN TRÚC TỔNG QUAN HỆ THỐNG

```mermaid
graph TB
    subgraph "Client Layer"
        WEB["Web App<br/>(Next.js)"]
        POS["POS Terminal<br/>(React)"]
        MOBILE["Mobile App"]
    end

    subgraph "Gateway Layer"
        NGINX["API Gateway<br/>(Nginx :8080)<br/>Rate Limiting · Routing · Load Balancing"]
    end

    subgraph "Service Layer — Microservices"
        direction TB

        subgraph "Domain: Identity & Access"
            S1["Auth Service<br/>:3001"]
            S4["Settings Service<br/>:3004"]
        end

        subgraph "Domain: Product & Supply"
            S2["Catalog Service<br/>:3002"]
            S5["Supplier Service<br/>:3005"]
        end

        subgraph "Domain: Warehouse & Stock"
            S6["Inventory Service<br/>:3006"]
        end

        subgraph "Domain: Sales & Finance"
            S3["Order Service<br/>:3003"]
            S7["Payment Service<br/>:3007"]
        end

        subgraph "Domain: Intelligence"
            S8["Chatbot Service<br/>:3008"]
            S9["Statistics Service<br/>:3009"]
        end
    end

    subgraph "Infrastructure Layer"
        PG[("PostgreSQL 16<br/>(pgvector)<br/>8 Databases")]
        RMQ["RabbitMQ<br/>Topic Exchange<br/>Event Bus"]
        REDIS[("Redis 7<br/>Cache & Sessions")]
    end

    WEB & POS & MOBILE -->|HTTPS| NGINX
    WEB -->|WebSocket| S8

    NGINX --> S1 & S2 & S3 & S4 & S5 & S6 & S7 & S8 & S9

    S1 & S2 & S3 & S4 & S5 & S6 & S7 & S8 --> PG
    S1 & S2 & S3 & S5 & S6 & S7 & S8 --> RMQ
    S9 --> REDIS & RMQ
```

---

## 2. SƠ ĐỒ CƠ SỞ DỮ LIỆU — DATABASE PER SERVICE

```mermaid
graph LR
    subgraph "PostgreSQL Instance (pgvector/pgvector:pg16)"

        subgraph "auth_db"
            A1[store]
            A2[user_account]
            A3[role]
            A4[permission]
            A5[role_permission]
            A6[employee]
            A7[customer]
            A8[auth_tokens]
            A9[pos_auth]
        end

        subgraph "catalog_db"
            C1[category]
            C2[product]
            C3[product_price_history]
        end

        subgraph "order_db"
            O1[sale_order]
            O2[sale_order_detail]
        end

        subgraph "settings_db"
            ST1[security_settings]
            ST2[sales_settings]
            ST3[settings_history]
        end

        subgraph "supplier_db"
            SP1[supplier]
            SP2[purchase_order]
            SP3[purchase_order_detail]
        end

        subgraph "inventory_db"
            I1[product_batch]
            I2[warehouse_block]
            I3[location]
            I4[inventory_item]
            I5[inventory_movement]
            I6[stock_out_order]
            I7[stock_out_detail]
            I8["v_product_inventory (VIEW)"]
        end

        subgraph "payment_db"
            P1[payment]
            P2[vnpay_transaction]
        end

        subgraph "chatbot_db"
            CB1[chat_session]
            CB2[chat_message]
            CB3["product_knowledge_base<br/>(pgvector)"]
        end
    end
```

---

## 3. SƠ ĐỒ QUAN HỆ THỰC THỂ (ER) — CROSS-SERVICE

```mermaid
erDiagram
    STORE ||--o{ EMPLOYEE : "has"
    STORE ||--o{ SALE_ORDER : "belongs to"
    STORE ||--o{ PURCHASE_ORDER : "belongs to"
    STORE ||--o{ PRODUCT_BATCH : "belongs to"
    STORE ||--o{ WAREHOUSE_BLOCK : "belongs to"
    STORE ||--o{ PAYMENT : "belongs to"
    STORE ||--o{ CHAT_SESSION : "context"
    STORE ||--o{ PRODUCT_KNOWLEDGE_BASE : "scoped to"

    USER_ACCOUNT ||--|| EMPLOYEE : "profile"
    USER_ACCOUNT ||--|| CUSTOMER : "profile"
    USER_ACCOUNT }o--|| ROLE : "has"
    ROLE }o--o{ PERMISSION : "grants"

    CATEGORY ||--o{ PRODUCT : "contains"
    CATEGORY ||--o{ CATEGORY : "parent-child"

    PRODUCT ||--o{ PRODUCT_BATCH : "instances"
    PRODUCT ||--o{ PRODUCT_PRICE_HISTORY : "price log"
    PRODUCT ||--o{ PRODUCT_KNOWLEDGE_BASE : "RAG vector"

    PRODUCT_BATCH ||--o{ INVENTORY_ITEM : "stocked at"
    INVENTORY_ITEM }o--|| LOCATION : "located in"
    INVENTORY_ITEM ||--o{ INVENTORY_MOVEMENT : "log"
    LOCATION }o--|| WAREHOUSE_BLOCK : "part of"

    CUSTOMER ||--o{ SALE_ORDER : "places"
    SALE_ORDER ||--o{ SALE_ORDER_DETAIL : "contains"
    SALE_ORDER_DETAIL }o--|| PRODUCT_BATCH : "from batch"

    SUPPLIER ||--o{ PURCHASE_ORDER : "supplies"
    PURCHASE_ORDER ||--o{ PURCHASE_ORDER_DETAIL : "contains"

    PAYMENT }o--|| SALE_ORDER : "pays for"
    PAYMENT ||--o| VNPAY_TRANSACTION : "online"

    USER_ACCOUNT ||--o{ CHAT_SESSION : "chats"
    CHAT_SESSION ||--o{ CHAT_MESSAGE : "contains"

    STORE {
        bigint id PK
        text name
        text address
        bigint manager_id FK
    }

    PRODUCT {
        bigint id PK
        bigint category_id FK
        text name
        numeric unit_price
        boolean is_active
        text vendor
    }

    PRODUCT_BATCH {
        bigint id PK
        bigint store_id FK
        bigint product_id FK
        numeric cost_price
        numeric unit_price
        date expiry_date
        text status
    }

    INVENTORY_ITEM {
        bigint id PK
        bigint product_batch_id FK
        bigint location_id FK
        int quantity_on_hand
        int quantity_on_shelf
        int quantity_reserved
    }

    SALE_ORDER {
        bigint id PK
        bigint store_id FK
        bigint customer_id FK
        text delivery_type
        numeric total_amount
        text payment_status
        text status
    }

    PRODUCT_KNOWLEDGE_BASE {
        bigint id PK
        bigint product_id FK
        bigint store_id FK
        text content
        vector embedding
        boolean is_in_stock
    }
```

---

## 4. SƠ ĐỒ GIAO TIẾP GIỮA CÁC SERVICE

### 4.1 Event-Driven Communication (RabbitMQ)

```mermaid
graph TB
    subgraph "posmart.events (Topic Exchange)"
        EX{{"RabbitMQ<br/>Topic Exchange"}}
    end

    subgraph "Publishers"
        S3_P["Order Service"]
        S7_P["Payment Service"]
        S6_P["Inventory Service"]
        S4_P["Settings Service"]
    end

    subgraph "Subscribers"
        S3_S["Order Service"]
        S6_S["Inventory Service"]
        S8_S["Chatbot Service"]
    end

    S3_P -->|"order.created"| EX
    S7_P -->|"payment.completed<br/>payment.failed<br/>payment.timeout"| EX
    S6_P -->|"stock.reserved<br/>stock.reservation_failed<br/>inventory.deduct_failed"| EX
    S4_P -->|"settings.promotion_updated<br/>settings.discount_updated"| EX

    EX -->|"order.created"| S6_S
    EX -->|"payment.*"| S3_S
    EX -->|"payment.*"| S6_S
    EX -->|"stock.*"| S3_S
    EX -->|"inventory.*"| S3_S
    EX -.->|"product.* (Phase 2)"| S8_S
    EX -.->|"inventory.* (Phase 2)"| S8_S

    style S8_S stroke-dasharray: 5 5
```

### 4.2 Synchronous HTTP Communication

```mermaid
graph LR
    subgraph "Service-to-Service HTTP Calls"
        S8_HTTP["Chatbot"]
        S3_HTTP["Order"]
        S9_HTTP["Statistics"]
    end

    S8_HTTP -->|"GET /api/products?search="| S2_T["Catalog :3002"]
    S8_HTTP -->|"GET /api/inventory/summary"| S6_T["Inventory :3006"]
    S8_HTTP -->|"GET /api/orders/:id"| S3_T["Order :3003"]

    S3_HTTP -->|"GET /api/inventory/batches/:productId<br/>(FEFO Allocation)"| S6_T2["📊 Inventory :3006"]

    S9_HTTP -->|"GET /api/orders"| S3_T2["Order :3003"]
    S9_HTTP -->|"GET /api/products"| S2_T2["Catalog :3002"]
    S9_HTTP -->|"GET /api/inventory/summary"| S6_T3["Inventory :3006"]
```

---

## 5. SƠ ĐỒ LUỒNG NGHIỆP VỤ CHÍNH

### 5.1 Luồng Bán Hàng POS (Point of Sale)

```mermaid
sequenceDiagram
    actor Cashier as Thu ngân
    participant POS as POS Terminal
    participant GW as Gateway
    participant Order as Order :3003
    participant Inv as Inventory :3006
    participant Pay as Payment :3007

    Cashier->>POS: Quét barcode sản phẩm
    POS->>GW: GET /api/products/:id
    GW->>Order: Forward request

    Cashier->>POS: Xác nhận giỏ hàng
    POS->>GW: POST /api/orders (draft)
    GW->>Order: createDraftOrder()
    Order->>Inv: GET /api/inventory/batches/:productId
    Inv-->>Order: Batches (FEFO sorted)
    Order->>Order: allocateBatchesFEFO()
    Order-->>POS: Draft order created

    Cashier->>POS: Thanh toán (tiền mặt/thẻ)
    POS->>GW: POST /api/payments
    GW->>Pay: createPayment(cash)
    Pay->>Pay: Record payment
    Pay-->>POS: Payment completed

    Note over Pay,Inv: Async via RabbitMQ
    Pay-)Order: Event: payment.completed
    Order->>Order: status → completed, paid

    Pay-)Inv: Event: payment.completed
    Inv->>Inv: deductStock() per batch
    Inv->>Inv: Record movement log
```

### 5.2 Luồng Đặt Hàng Online (Saga Pattern)

```mermaid
sequenceDiagram
    actor Customer as Khách hàng
    participant Web as Web App
    participant GW as Gateway
    participant Order as Order :3003
    participant Outbox as Outbox
    participant Inv as Inventory :3006
    participant Pay as Payment :3007

    Customer->>Web: Chọn sản phẩm + Đặt hàng
    Web->>GW: POST /api/orders/online
    GW->>Order: createOnlineOrder()
    Order->>Inv: GET /api/inventory/batches/:id
    Inv-->>Order: Batches (FEFO)
    Order->>Order: allocateBatchesFEFO()

    rect rgb(240, 248, 255)
        Note over Order,Outbox: Atomic Transaction
        Order->>Order: INSERT sale_order (pending)
        Order->>Outbox: INSERT outbox_event (order.created)
    end
    Order-->>Web: Order created (pending)

    rect rgb(255, 248, 240)
        Note over Outbox,Inv: Saga Phase 1: Reserve Stock
        Outbox-)Inv: Event: order.created
        Inv->>Inv: reserveStock()
        Note over Inv: on_shelf -= qty<br/>reserved += qty
        alt Reserve Success
            Inv-)Order: Event: stock.reserved
            Order->>Order: status → reserved
        else Reserve Failed
            Inv-)Order: Event: stock.reservation_failed
            Order->>Order: status → cancelled
        end
    end

    Customer->>Web: Thanh toán VNPay
    Web->>GW: POST /api/payments/vnpay
    GW->>Pay: createVNPayURL()
    Pay-->>Web: VNPay redirect URL
    Web->>Web: Redirect to VNPay

    rect rgb(240, 255, 240)
        Note over Pay,Inv: Saga Phase 2: Confirm or Compensate
        alt Payment Success
            Pay-)Order: Event: payment.completed
            Order->>Order: status → completed, paid
            Pay-)Inv: Event: payment.completed
            Inv->>Inv: confirmDeduct()
            Note over Inv: reserved -= qty (sold)
        else Payment Failed / Timeout
            Pay-)Order: Event: payment.failed
            Order->>Order: status → cancelled
            Pay-)Inv: Event: payment.failed
            Inv->>Inv: releaseStock()
            Note over Inv: reserved -= qty<br/>on_shelf += qty (restore)
        end
    end
```

### 5.3 Luồng Nhập Hàng (Purchase Order)

```mermaid
sequenceDiagram
    actor Manager as Quản lý kho
    participant Web as Web App
    participant Supp as Supplier :3005
    participant Inv as Inventory :3006
    participant Pay as Payment :3007

    Manager->>Web: Tạo đơn nhập hàng
    Web->>Supp: POST /api/purchase-orders
    Supp->>Supp: INSERT purchase_order (draft)
    Supp-->>Web: PO created

    Manager->>Web: Duyệt đơn
    Web->>Supp: PATCH /api/purchase-orders/:id (approved)

    Note over Manager,Inv: Hàng về → Nhận hàng
    Manager->>Web: Xác nhận nhận hàng
    Web->>Supp: PATCH /api/purchase-orders/:id (received)

    rect rgb(240, 248, 255)
        Note over Supp,Inv: Event: purchaseorder.received
        Supp-)Inv: PO received (products + qty)
        Inv->>Inv: createBatch() per product
        Inv->>Inv: receiveStock()
        Note over Inv: Tạo inventory_item<br/>quantity_on_hand += qty
        Inv->>Inv: Record movement (in)
    end

    Manager->>Web: Thanh toán NCC
    Web->>Pay: POST /api/payments (PurchaseOrder)
    Pay->>Pay: Record payment
    Pay-)Supp: Event: payment.completed
    Supp->>Supp: Update supplier.current_debt
```

---

## 6. SƠ ĐỒ LUỒNG CHATBOT RAG RECOMMENDATION

### 6.1 Data Ingestion Pipeline

```mermaid
graph TB
    subgraph "Data Sources (Every 15 minutes)"
        CAT["Catalog Service<br/>GET /api/products<br/>(tên, giá, danh mục, vendor)"]
        INV["Inventory Service<br/>GET /api/inventory/summary<br/>(tồn kho per store)"]
    end

    subgraph "Chatbot Service — Data Ingestion"
        CRON["Cron Scheduler<br/>(*/15 * * * *)"]
        INGEST["DataIngestionService"]
        MERGE["Merge & Format<br/>Content Template"]
        EMB["EmbeddingClient<br/>(vietnamese-sbert)<br/>@xenova/transformers"]
        UPSERT["UPSERT<br/>product_knowledge_base"]
    end

    subgraph "chatbot_db"
        KB[("product_knowledge_base<br/>├── product_id<br/>├── store_id<br/>├── content (text)<br/>├── embedding VECTOR(768)<br/>├── is_in_stock<br/>└── quantity_on_shelf")]
    end

    CRON --> INGEST
    CAT --> INGEST
    INV --> INGEST
    INGEST --> MERGE
    MERGE -->|"Sản phẩm Bia Tiger,<br/>danh mục Bia,<br/>giá 15,000 VND..."| EMB
    EMB -->|"[0.023, -0.156, ...]<br/>768 dimensions"| UPSERT
    UPSERT --> KB
```

### 6.2 RAG Query Flow (User Recommendation)

```mermaid
sequenceDiagram
    actor User as Khách hàng
    participant FE as Frontend
    participant WS as Socket.IO
    participant Chat as ChatService
    participant Intent as IntentResolver
    participant RAG as RAGService
    participant Emb as EmbeddingClient
    participant KB as KnowledgeBase
    participant LLM as HF LLM

    User->>FE: "Gợi ý mình vài loại bia ngon"
    FE->>WS: chat:send_message
    WS->>Chat: sendMessage(sessionId, message)
    Chat->>Intent: resolveIntent(message)
    Intent-->>Chat: intent = RECOMMENDATION

    Chat->>RAG: recommend(message, storeId)

    rect rgb(240, 248, 255)
        Note over RAG,KB: Step 1: Vector Search
        RAG->>Emb: embed("Gợi ý mình vài loại bia ngon")
        Emb-->>RAG: query_vector [768 dim]
        RAG->>KB: searchSimilar(vector, storeId)
        Note over KB: WHERE store_id = 1<br/>AND is_in_stock = TRUE<br/>ORDER BY embedding <=> query<br/>LIMIT 5
        KB-->>RAG: Top 5 products
    end

    rect rgb(240, 255, 240)
        Note over RAG,LLM: Step 2: Augmented Generation
        RAG->>LLM: System prompt + product data + user question
        Note over LLM: "Dựa trên sản phẩm:<br/>1. Bia Tiger (15,000đ)<br/>2. Bia Heineken (22,000đ)...<br/>Hãy gợi ý cho khách"
        LLM-->>RAG: Natural language response
    end

    RAG-->>Chat: { content, productIds, products }
    Chat-->>WS: reply + metadata
    WS-->>FE: chat:message_received
    FE->>FE: Render AI text + Product Cards
    Note over FE: 🛒 Hiển thị thẻ sản phẩm<br/>với nút "Thêm vào giỏ"
```

---

## 7. SƠ ĐỒ MÔ HÌNH MULTI-TENANCY

```mermaid
graph TB
    subgraph "Chain Level (Shared)"
        UP["user_account<br/>(all users)"]
        ROLE["role + permission<br/>(RBAC)"]
        PROD["product + category<br/>(Catalog centralized)"]
        SUPP2["supplier<br/>(shared pool)"]
        SET["sales_settings<br/>(chain-wide policy)"]
    end

    subgraph "Store Level (Isolated by store_id)"
        subgraph "Store A (id=1)"
            S1_EMP["employee<br/>store_id=1"]
            S1_BATCH["product_batch<br/>store_id=1"]
            S1_INV["inventory_item<br/>(via batch)"]
            S1_WH["warehouse_block<br/>store_id=1"]
            S1_ORDER["sale_order<br/>store_id=1"]
            S1_PAY["payment<br/>store_id=1"]
            S1_CHAT["chat_session<br/>store_id=1"]
            S1_KB["knowledge_base<br/>store_id=1"]
        end

        subgraph "Store B (id=2)"
            S2_EMP["employee<br/>store_id=2"]
            S2_BATCH["product_batch<br/>store_id=2"]
            S2_INV["inventory_item<br/>(via batch)"]
            S2_WH["warehouse_block<br/>store_id=2"]
            S2_ORDER["sale_order<br/>store_id=2"]
            S2_PAY["payment<br/>store_id=2"]
            S2_CHAT["chat_session<br/>store_id=2"]
            S2_KB["knowledge_base<br/>store_id=2"]
        end
    end

    UP --> S1_EMP & S2_EMP
    PROD --> S1_BATCH & S2_BATCH
    PROD --> S1_KB & S2_KB
```

---

## 8. SƠ ĐỒ LUỒNG XÁC THỰC & PHÂN QUYỀN (RBAC)

```mermaid
sequenceDiagram
    actor User as User
    participant FE as Frontend
    participant GW as Gateway
    participant Auth as Auth :3001
    participant Target as Target Service

    User->>FE: Login (email + password)
    FE->>GW: POST /api/auth/login
    GW->>Auth: Verify credentials
    Auth->>Auth: bcrypt.compare(password, hash)

    alt Credentials Valid
        Auth->>Auth: Generate JWT
        Note over Auth: payload: {<br/>  id, email, role,<br/>  storeId, permissions<br/>}
        Auth-->>FE: { token, refreshToken, user }
    else Invalid
        Auth-->>FE: 401 Unauthorized
    end

    Note over FE: Store JWT in memory

    FE->>GW: GET /api/orders (+ Bearer token)
    GW->>Target: Forward with JWT
    Target->>Target: verifyToken middleware
    Target->>Target: Check role/permissions
    Target-->>FE: Data (filtered by storeId)
```

---

## 9. SƠ ĐỒ QUẢN LÝ TỒN KHO (Inventory Flow)

```mermaid
stateDiagram-v2
    [*] --> OnHand : PO Received<br/>(receiveStock)

    OnHand --> OnShelf : Move to Shelf<br/>(moveStockToShelf)
    OnShelf --> OnHand : Return to Warehouse<br/>(moveStockToShelf negative)

    OnShelf --> Reserved : Order Created<br/>(reserveStock)
    Reserved --> OnShelf : Payment Failed<br/>(releaseStock)
    Reserved --> Sold : Payment Completed<br/>(confirmDeduct)

    OnShelf --> Deducted : POS Sale<br/>(deductStock)

    OnHand --> Adjusted : Manual Adjustment<br/>(adjustStock)
    OnShelf --> Adjusted : Manual Adjustment<br/>(adjustStock)

    Adjusted --> OnHand : Increase
    Adjusted --> OnShelf : Increase

    state "quantity_on_hand" as OnHand
    state "quantity_on_shelf" as OnShelf
    state "quantity_reserved" as Reserved
    state "Sold (removed)" as Sold
    state "Deducted (removed)" as Deducted
    state "Adjustment" as Adjusted
```

---

## 10. SƠ ĐỒ DEPLOYMENT (Docker Compose)

```mermaid
graph TB
    subgraph "Docker Compose Stack"
        subgraph "Network: posmart_default"

            subgraph "Infrastructure (Always Running)"
                PG["postgres<br/>pgvector/pgvector:pg16<br/>Port: 5432<br/>Volume: pgdata"]
                RMQ["rabbitmq<br/>3-management-alpine<br/>Port: 5672, 15672<br/>Volume: rabbitmq_data"]
                REDIS["redis<br/>7-alpine<br/>Port: 6379<br/>Volume: redis_data"]
            end

            subgraph "Gateway"
                NGX["🔀 nginx<br/>alpine<br/>Port: 8080→80"]
            end

            subgraph "Application Services"
                A1["auth :3001"]
                A2["catalog :3002"]
                A3["order :3003"]
                A4["settings :3004"]
                A5["supplier :3005"]
                A6["inventory :3006"]
                A7["payment :3007"]
                A8["chatbot :3008"]
                A9["statistics :3009"]
            end
        end
    end

    PG -.->|healthcheck| A1 & A2 & A3 & A4 & A5 & A6 & A7 & A8
    RMQ -.->|healthcheck| A1 & A2 & A3 & A5 & A6 & A7 & A8 & A9
    REDIS -.->|healthcheck| A9
    A1 & A2 & A3 & A4 & A5 & A6 & A7 & A8 & A9 -.-> NGX
```

---

## 11. SƠ ĐỒ TECH STACK

```mermaid
mindmap
    root((POSMART))
        Backend
            Node.js
            Express.js
            PostgreSQL 16
                pgvector
            RabbitMQ
                amqplib
            Redis 7
            Socket.IO
        AI / ML
            HuggingFace Inference
                Phi-3-mini-4k-instruct
            vietnamese-sbert
                "@xenova/transformers"
            RAG Pipeline
                Vector Search (HNSW)
                Metadata Filtering
        Frontend
            Next.js
            React
            TailwindCSS
        DevOps
            Docker Compose
            Nginx Gateway
            Health Checks
        Patterns
            Microservices
            Event-Driven (Topic Exchange)
            Saga Pattern (Choreography)
            Outbox Pattern
            FEFO Batch Allocation
            Database per Service
            Multi-Tenancy (store_id)
            RBAC
```

---

## 12. BẢN ĐỒ PHỤ THUỘC GIỮA CÁC SERVICE

```mermaid
graph TD
    S1["Auth<br/>(Identity Root)"]
    S2["Catalog<br/>(Product Master)"]
    S4["Settings<br/>(Config)"]
    S5["Supplier<br/>(Inbound)"]
    S6["Inventory<br/>(Warehouse)"]
    S3["Order<br/>(Outbound)"]
    S7["Payment<br/>(Finance)"]
    S8["Chatbot<br/>(Intelligence)"]
    S9["Statistics<br/>(Analytics)"]

    S1 -->|"user_id, store_id"| S3
    S1 -->|"user_id, store_id"| S5
    S1 -->|"user_id, store_id"| S6
    S1 -->|"user_id"| S8

    S2 -->|"product_id, price"| S5
    S2 -->|"product_id, price"| S6
    S2 -->|"product_id, price"| S3
    S2 -->|"product data"| S8

    S6 -->|"batch_id, stock"| S3
    S6 -->|"stock status"| S8

    S3 -->|"order_id"| S7
    S5 -->|"po_id"| S7

    S3 -->|"order data"| S8
    S3 -->|"sales data"| S9
    S2 -->|"product data"| S9
    S6 -->|"stock data"| S9

    S4 -->|"discount rules"| S3

    style S8 fill:#e1f5fe
    style S1 fill:#fce4ec
    style S2 fill:#e8f5e9
    style S6 fill:#fff3e0
```

---

## DANH MỤC SƠ ĐỒ

| # | Tên Sơ Đồ | Loại | Mục đích |
|---|-----------|------|----------|
| 1 | Kiến trúc Tổng Quan | Architecture | Full system overview |
| 2 | Cơ Sở Dữ Liệu | Database | 8 databases, all tables |
| 3 | Quan Hệ Thực Thể (ER) | ER Diagram | Cross-service entity relationships |
| 4 | Giao Tiếp Service | Communication | Event-driven + HTTP patterns |
| 5.1 | Luồng Bán Hàng POS | Sequence | POS checkout flow |
| 5.2 | Luồng Đặt Hàng Online | Sequence | Saga pattern (reserve → pay → confirm) |
| 5.3 | Luồng Nhập Hàng | Sequence | Purchase order → receive → stock |
| 6.1 | RAG Data Ingestion | Data Flow | Cron sync pipeline |
| 6.2 | RAG Query Flow | Sequence | Vector search → LLM generation |
| 7 | Multi-Tenancy | Architecture | Store-level data isolation |
| 8 | Xác Thực & RBAC | Sequence | JWT auth + role-based access |
| 9 | Quản Lý Tồn Kho | State Machine | Inventory state transitions |
| 10 | Deployment | Infrastructure | Docker Compose topology |
| 11 | Tech Stack | Mindmap | All technologies used |
| 12 | Phụ Thuộc Service | Dependency | Inter-service data dependencies |
