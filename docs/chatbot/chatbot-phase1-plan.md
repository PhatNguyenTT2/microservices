# Chatbot Algorithm Plan — Phase 1 Implementation

> **Dự án**: POSMART Chatbot AI  
> **Baseline**: `implementation_plan.md` (root) — 3-phase roadmap  
> **Cập nhật**: 2026-04-18 — Tiến độ thực tế + plan chi tiết Phase 1  

---

## Tiến độ hiện tại

### ✅ Đã hoàn thành

| Task | Chi tiết | Ngày |
|---|---|---|
| RAG Pipeline 7-step | pgvector + tsvector Hybrid Search + RRF k=60 | Trước đó |
| Co-purchase pairwise counting | `co_purchase_stats` table + `CoPurchaseRepository` | Trước đó |
| Co-purchase inject vào RAG | `context.helper.js` → `getCoPurchaseContext()` → LLM prompt | Trước đó |
| Data Orchestration Scripts | `clear-orders.js`, `clear-payment-customer.js`, `clear-customers.js` | 2026-04-17 |
| Mock 500 orders | 35% LẩuBò, 35% BữaSáng, 15% GiảiKhát, 15% Random → 6892 detail rows | 2026-04-17 |
| Populate co-purchase pairs | `populate-copurchase.js` v2 (batch) → 1770 unique pairs, max_freq=188, 5.1s | 2026-04-18 |
| Customer registration flow | Backend + Frontend: username, address, gender, dob | 2026-04-17 |

### ⚠️ Known Bugs

| Bug | Status | Mô tả |
|---|---|---|
| **Order event `productId: null`** | 🔴 Cần fix ở Phase 1 | `allocateBatchesFEFO()` drop `product_id` khi map → `sale_order_detail` không lưu → `ORDER_COMPLETED` event gửi `productId: null` → chatbot `handleOrderCompleted` insert NULL vào `co_purchase_stats` (NOT NULL constraint) → **co-purchase pipeline production KHÔNG hoạt động** |
| **populate-copurchase v1 treo >1h** | ✅ Đã fix | 3500+ SQL queries qua Supabase → v2 batch INSERT |

---

## Phase 1 — Chi tiết Implementation

> **Mục tiêu**: Tối ưu search quality + Apriori metrics đúng chuẩn + Fix production pipeline  
> **Files thay đổi**: 5 modify + 3 new  
> **Tham chiếu**: `implementation_plan.md` root → Section 1A + 1B

### Task 1: Fix Bug `productId: null` trong Order Event Pipeline 🔴

**Root Cause** (deep scan 2026-04-17):

```
Frontend gửi items[] có product_id
       ↓
allocateBatchesFEFO() → output CHỈ có: { product_name, batch_id, quantity, unit_price }
       ↓ ❌ product_id bị DROP
sale_order_detail INSERT (không có cột product_id)
       ↓
Order delivered → ORDER_COMPLETED event
       ↓ productId: null (line 265 & 329)
Chatbot handleOrderCompleted()
       ↓ SQL FAIL: NOT NULL constraint on co_purchase_stats
```

**Fix — 2 options**:

| Option | Pros | Cons |
|---|---|---|
| **A**: Thêm `product_id` vào `sale_order_detail` | Clean, truy vết được, event có data | Schema migration |
| **B**: Order event gửi kèm product_id từ request payload (cache trong memory) | Không cần migration | Phức tạp, product_id mất khi restart |

**Đề xuất: Option A** — thêm `product_id BIGINT` vào `sale_order_detail` + lưu khi insert.

#### Files thay đổi:

| File | Thay đổi |
|---|---|
| `order/src/db/init.sql` | Migration: `ALTER TABLE sale_order_detail ADD COLUMN IF NOT EXISTS product_id BIGINT` |
| `order/src/services/order.service.js` | `allocateBatchesFEFO()`: preserve `product_id` trong output. `updateOrder/updateOrderStatus`: đọc `product_id` từ detail row thay vì null |
| `order/src/repositories/order-detail.repository.js` | `addDetailWithClient()`: INSERT thêm `product_id` |

---

### Task 2: Schema Migration — Apriori Metrics

> Tham chiếu: `implementation_plan.md` root → Section 1B.3

#### [NEW] `chatbot/src/db/migration-apriori.sql`

```sql
-- Apriori metrics columns
ALTER TABLE co_purchase_stats
    ADD COLUMN IF NOT EXISTS support NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS confidence_ab NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS confidence_ba NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS lift NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_orders INT DEFAULT 0;

-- Index cho query theo lift
CREATE INDEX IF NOT EXISTS idx_copurchase_confidence
    ON co_purchase_stats(product_id_a, store_id)
    WHERE confidence_ab >= 0.3;

-- Single-item frequency (support(A) denominator)
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

> Tham chiếu: `implementation_plan.md` root → Section 1B.4  
> **Performance**: In-memory aggregation (tránh N+1 query)

#### [NEW] `docs/chatbot/seed-product/apriori-batch.js`

Logic:
1. **1 query**: `SELECT COUNT(*) FROM sale_order WHERE status='delivered'` → `total_orders`
2. **1 query**: Đọc product frequency từ `sale_order_detail` GROUP BY `product_name` → map → `product_order_frequency`
3. **In-memory**: Tính support, confidence_ab, confidence_ba, lift cho mỗi pair
4. **Batch UPDATE**: 1 query cập nhật toàn bộ `co_purchase_stats`

```
support(A,B)     = co_purchase_count / total_orders
confidence(A→B)  = co_purchase_count / count(A)
confidence(B→A)  = co_purchase_count / count(B)
lift(A,B)        = confidence(A→B) / support(B)
                 = (co_purchase_count × total_orders) / (count(A) × count(B))
```

**Kỳ vọng với seed data** (từ plan gốc):
```
Cluster LAU_BO: products [1,2,3,4,5] — 35% × 500 = ~175 đơn
- support(1,4) ≈ 0.28, confidence(1→4) ≈ 0.80, lift(1,4) ≈ 2.42
- Lift >> 1 → Tương quan MẠNH → gợi ý chính xác
```

---

### Task 4: Upgrade CoPurchaseRepository — Ranking by Lift

> Tham chiếu: `implementation_plan.md` root → Section 1B.5

#### [MODIFY] `copurchase.repository.js`

```diff
  async getRelatedProducts(productId, storeId, minCount = 3) {
      const { rows } = await this.pool.query(`
-         SELECT product_id_b, co_purchase_count
+         SELECT product_id_b, co_purchase_count, confidence_ab, lift
          FROM co_purchase_stats
-         WHERE product_id_a = $1 AND store_id = $2 AND co_purchase_count >= $3
+         WHERE product_id_a = $1 AND store_id = $2
+           AND co_purchase_count >= $3 AND lift > 1
          UNION ALL
-         SELECT product_id_a, co_purchase_count
+         SELECT product_id_a, co_purchase_count, confidence_ba AS confidence_ab, lift
          FROM co_purchase_stats
-         WHERE product_id_b = $1 AND store_id = $2 AND co_purchase_count >= $3
-         ORDER BY co_purchase_count DESC
+         WHERE product_id_b = $1 AND store_id = $2
+           AND co_purchase_count >= $3 AND lift > 1
+         ORDER BY lift DESC, co_purchase_count DESC
          LIMIT 3
      `, [productId, storeId, minCount]);
```

---

### Task 5: Content-Based Search Improvements

> Tham chiếu: `implementation_plan.md` root → Section 1A.1 + 1A.2

#### [MODIFY] `data-ingestion.service.js` — Context Keywords

Thêm `CONTEXT_KEYWORDS` map cho 25 subcategories → enrich FTS content.

#### [MODIFY] `rag.service.js` — Weighted RRF

```diff
- _reciprocalRankFusion(semanticList, keywordList, k = 60) {
+ _reciprocalRankFusion(semanticList, keywordList, k = 60, weights = { semantic: 0.6, keyword: 0.4 }) {
```

---

### Task 6: Enrich LLM Prompt với Confidence %

#### [MODIFY] `context.helper.js`

```diff
- `Product #${cp.productId} → ${cp.related.map(r => `Product #${r.product_id_b}`).join(', ')}`
+ `${cp.productName} → ${cp.related.map(r =>
+     `Product #${r.product_id_b} (${(r.confidence_ab * 100).toFixed(0)}% mua kèm, lift=${r.lift.toFixed(1)})`
+ ).join(', ')}`
```

---

### Task 7: Update Populate Script + Run Order

#### [MODIFY] `populate-copurchase.js`

Thêm bước cuối: auto-gọi apriori-batch logic.

#### Quy trình chạy hoàn chỉnh:
```bash
# 1. Seed products (nếu chưa)
psql $CATALOG_DATABASE_URL -f docs/chatbot/seed-product/seed.sql

# 2. Mock 500 orders
node docs/chatbot/seed-product/mock-orders.js

# 3. Populate co-purchase pairs
node docs/chatbot/seed-product/populate-copurchase.js

# 4. Tính Apriori metrics
node docs/chatbot/seed-product/apriori-batch.js

# 5. Verify
psql $DATABASE_URL -c "
  SELECT product_id_a, product_id_b, co_purchase_count,
         ROUND(confidence_ab, 2) as conf, ROUND(lift, 2) as lift
  FROM co_purchase_stats
  WHERE store_id = 1 AND confidence_ab >= 0.6
  ORDER BY lift DESC LIMIT 10;
"
```

---

## Test Cases Phase 1

> Tham chiếu: `implementation_plan.md` root → Section 1B.6

| TC | Input | Expected | Result (2026-04-20) |
|---|---|---|---|
| TC 1.1 | "đồ nêm nếm" | Hạt nêm(52), Bột ngọt(53), Nước mắm(49,50) | ✅ **PASS** — 4 results, 50% match (3/6) |
| TC 1.2 | "giải khát mát lạnh" | Coca-Cola(19), Bia(17), Trà ÔLong(40) | ✅ **PASS** — 7 results, 100% match (7/7) |
| TC 2.1 | Cart [1,2] → "mua thêm?" | GiaVị(4), Rau(3), Bún(5) | ✅ **PASS** — 100% cluster match, count≥50 |
| TC 2.2 | Xem Bánh mì(7) | Sữa(8), Trứng(10), XúcXích(11) | ✅ **PASS** — 100% cluster match, count≥50 |
| TC-BUG | product_id column | sale_order_detail.product_id exists | ✅ **PASS** — bigint, 6280/6280 rows |

**Automated Test Script**: `docs/chatbot/seed-product/test-algorithm.js`
```bash
cd microservices && node docs/chatbot/seed-product/test-algorithm.js
# ✅ 5/5 PASS (2026-04-20)
```

---

## Execution Priority

| Priority | Task | Status |
|---|---|---|
| 🔴 P0 | Task 1: Fix productId null | ✅ **DONE** (Phase 1A) |
| 🟡 P1 | Task 2: Schema migration (Apriori) | ✅ **DONE** — 5 columns + `product_order_frequency` table |
| 🟡 P1 | Task 3: Apriori batch job | ✅ **DONE** — 1770 pairs, max lift=4.74, max conf=88.1% |
| 🟢 P2 | Task 4: Repository upgrade (lift ranking) | ✅ **DONE** — `ORDER BY lift DESC`, `getAprioriMetrics()` |
| 🟢 P2 | Task 5: Search improvements | ✅ **Verified** — TC-1.1, TC-1.2 PASS |
| 🟢 P2 | Task 6: Prompt enrichment | ✅ **DONE** — `"Nấm kim châm (88% mua kèm)"` |
| ⚪ P3 | Task 7: Script updates | ✅ **DONE** — test queries include confidence/lift |

> **Phase 1 COMPLETE** ✅ — All 7 tasks done. 5/5 tests PASS. Ready for Phase 2.

---

## Phase 2 & 3 — Deferred

> Chi tiết trong `implementation_plan.md` (root) — Section Phase 2 + Phase 3.

| Phase | Thuật toán | Điều kiện | Effort |
|---|---|---|---|
| Phase 2 | Item-based Collaborative Filtering | ≥500 users + ≥2000 orders | 2-3 tuần |
| Phase 3 | Hybrid Ensemble + Session GRU | Phase 1+2 stable + ≥5000 sessions | 3-4 tuần |
