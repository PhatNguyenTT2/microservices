# TỔNG QUAN LUỒNG RAG SAU KHI NÂNG CẤP

## Nguyên tắc thiết kế

Với **PostgreSQL làm trung tâm**, tận dụng tối đa sức mạnh của DB thay vì kéo dữ liệu về RAM của Node.js:

| Thành phần | Công nghệ | Lý do |
|-----------|-----------|-------|
| Vector Search | pgvector (`<=>` cosine) | Đã tích hợp sẵn trong PostgreSQL |
| Keyword Search | tsvector + GIN index | Full-text search bản địa, không cần BM25 in-memory |
| Rank Fusion | RRF trên Node.js | Đơn giản, hiệu quả, không cần stored procedure |
| Event Sync | RabbitMQ subscribe | Gần real-time, phù hợp kiến trúc microservices hiện tại |

## Pipeline RAG hoàn chỉnh (7 bước)

```
User message
  → 1. Intent Resolution (keyword match → RECOMMENDATION?)
  → 2. Query Reformulation (viết lại nếu có đại từ "nó", "cái đó")
  → 3. Embed query (Vietnamese SBERT → vector 768d)
  → 4. Hybrid Search (song song):
       ├── Semantic: pgvector cosine distance (store_id + is_in_stock filter)
       └── Keyword: tsvector full-text search (cùng filter)
  → 5. RRF Fusion: score(d) = SUM(1 / (60 + rank)) → Top 5
  → 6. Enrichment:
       ├── Co-purchase: "Thường mua kèm: Đá viên, Khô bò"
       └── Personalization: VIP → premium | Sỉ → bulk | Lẻ → deals
  → 7. LLM Generation (Phi-3-mini + augmented prompt)
  → Response + productIds
```

## Data Ingestion Pipeline

```
┌─────────────────────────────────────────────────────┐
│  PRIMARY: Event-Driven Sync (gần real-time)         │
│                                                     │
│  product.created/updated → embed → UPSERT KB        │
│  product.deleted → DELETE KB                        │
│  inventory.updated → UPDATE is_in_stock, qty        │
│  order.completed → UPSERT co_purchase_stats         │
│                                                     │
│  FALLBACK: Cron */30 * * * * full-sync              │
│  (bắt trường hợp mất event hoặc service restart)    │
└─────────────────────────────────────────────────────┘
```

## Content Template (tối ưu cho cả Vector + Keyword)

```
Sản phẩm "Bia Tiger lon 330ml", danh mục "Đồ uống có cồn", giá 15.000đ.
Từ khóa: bia tiger, tiger beer, lon 330ml.
```

- Câu văn tự nhiên → Vietnamese SBERT bắt ngữ nghĩa
- "Từ khóa:" → tsvector bắt chính xác tên/SKU/thương hiệu
- Lưu đồng thời `embedding VECTOR(768)` + `fts_content TSVECTOR`

## Tham khảo chi tiết

- Implementation Plan: `docs/chatbot/chatbot-rag-implementation-plan.md`
- Báo cáo đồ án: `docs/chatbot/bao-cao-chatbot-rag.md`