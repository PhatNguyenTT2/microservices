# Phase 1B — Apriori Metrics Implementation Plan

> **Prerequisite**: Phase 1A ✅ (P0 fix + data seeded + 5/5 tests pass)  
> **Scope**: Tasks 2, 3, 4, 6, 7 từ `chatbot-phase1-plan.md`  
> **Tham chiếu**: `implementation_plan.md` root → Section 1B.1 ~ 1B.5  
> **Effort**: ~2-3 giờ implement + test

---

## Mục tiêu

Nâng cấp co-purchase từ **raw frequency counting** lên **Apriori chuẩn** với support/confidence/lift:

```
TRƯỚC (Phase 1A):  "Bò → Nấm (count=163)"           → chỉ đếm tần suất
SAU (Phase 1B):    "Bò → Nấm (conf=93%, lift=2.4)"   → xác suất + tương quan
```

**Tác động trực tiếp**:
- CoPurchaseRepository ranking chính xác hơn (lift > frequency)
- LLM prompt có thêm % confidence → chatbot trả lời thuyết phục hơn
- Test case TC-2.1/TC-2.2 verify bằng metrics thật (không chỉ count)

---

## Task Breakdown

### Task 2: Schema Migration

> Tham chiếu: `implementation_plan.md` → Section 1B.3

#### [MODIFY] `chatbot/src/db/init.sql`

Thêm Apriori columns vào `co_purchase_stats` + bảng `product_order_frequency`:

```sql
-- 1. Apriori metrics columns
ALTER TABLE co_purchase_stats
    ADD COLUMN IF NOT EXISTS support NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS confidence_ab NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS confidence_ba NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS lift NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_orders INT DEFAULT 0;

-- 2. Index cho query theo lift (partial — chỉ rows có confidence đủ cao)
CREATE INDEX IF NOT EXISTS idx_copurchase_lift
    ON co_purchase_stats(product_id_a, store_id)
    WHERE lift > 1;

-- 3. Bảng frequency từng sản phẩm (denominator cho confidence)
CREATE TABLE IF NOT EXISTS product_order_frequency (
    product_id BIGINT NOT NULL,
    store_id BIGINT NOT NULL,
    order_count INT DEFAULT 0,
    last_computed_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (product_id, store_id)
);
```

---

### Task 3: Apriori Batch Job

> Tham chiếu: `implementation_plan.md` → Section 1B.4  
> **Strategy**: In-memory (tránh N+1 — bài học populate-copurchase v1)

#### [NEW] `docs/chatbot/seed-product/apriori-batch.js`

Standalone script tính Apriori metrics từ existing data:

```
Input:  sale_order_detail (product_id + order_id) + co_purchase_stats
Output: support, confidence_ab, confidence_ba, lift cho mỗi pair

Flow:
┌─────────────────────────────────────────────────────────┐
│ 1. COUNT total_orders (status='delivered')              │
│ 2. 1 query: GROUP BY product_id → order_count mỗi SP   │
│ 3. UPSERT product_order_frequency (batch)               │
│ 4. In-memory: tính metrics cho mỗi pair trong           │
│    co_purchase_stats                                     │
│ 5. Batch UPDATE co_purchase_stats SET support=...        │
└─────────────────────────────────────────────────────────┘
```

**Công thức** (từ plan gốc 1B.1):
```
support(A,B)     = co_purchase_count / total_orders
confidence(A→B)  = co_purchase_count / count_orders(A)
confidence(B→A)  = co_purchase_count / count_orders(B)  
lift(A,B)        = (co_purchase_count × total_orders) / (count(A) × count(B))
```

**Kỳ vọng kết quả** (cluster LAU_BO):
```
Pair (1,2) Bò↔Nấm:   count=163, support≈0.33, conf≈0.93, lift≈2.4
Pair (7,8) Mì↔Sữa:   count=183, support≈0.37, conf≈1.05, lift≈2.8
Random pairs:          lift≈1.0 (no correlation)
```

---

### Task 4: Repository Upgrade

#### [MODIFY] `copurchase.repository.js`

`getRelatedProducts()` changes:
- **Sort**: `ORDER BY lift DESC` thay vì `co_purchase_count DESC`
- **Filter**: `WHERE lift > 1` (chỉ lấy positive correlation)
- **Return**: thêm `confidence_ab`, `lift` trong response

Thêm method mới:
- `getAprioriMetrics(productIdA, productIdB, storeId)` — debug/monitoring

---

### Task 6: Prompt Enrichment

#### [MODIFY] `context.helper.js`

`getCoPurchaseContext()` output change:
```
TRƯỚC: "Product #1 → Product #2, Product #3"
SAU:   "Ba chỉ bò Mỹ → Nấm kim châm (93% mua kèm), Gia vị lẩu Thái (86% mua kèm)"
```

---

### Task 7: Script Integration

#### [MODIFY] `populate-copurchase.js`

Thêm bước cuối: auto-gọi apriori-batch logic.

#### [MODIFY] `test-algorithm.js`

Upgrade TC-2.1 và TC-2.2 để verify confidence/lift columns.

---

## Execution Order

```
Step 1: Schema migration (chatbot init.sql)        → docker compose up --build
Step 2: apriori-batch.js (tính metrics)             → node apriori-batch.js
Step 3: copurchase.repository.js (lift ranking)     → code change
Step 4: context.helper.js (prompt enrichment)       → code change
Step 5: test-algorithm.js (upgrade asserts)          → node test-algorithm.js
Step 6: populate-copurchase.js (auto-call apriori)  → convenience
```

---

## Verification

```bash
# 1. After migration + apriori-batch
psql -c "SELECT product_id_a, product_id_b, co_purchase_count,
         ROUND(support, 4) AS support,
         ROUND(confidence_ab, 3) AS conf_ab,
         ROUND(lift, 2) AS lift
  FROM co_purchase_stats
  WHERE store_id = 1 
  ORDER BY lift DESC LIMIT 10;"

# Expected: LAU_BO pairs have lift > 2.0, random pairs lift ≈ 1.0

# 2. Upgrade test suite
node docs/chatbot/seed-product/test-algorithm.js
# Expected: 5/5 PASS with confidence/lift values printed
```
