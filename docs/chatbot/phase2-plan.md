# Phase 2 — Item-based Collaborative Filtering Plan ✅ COMPLETE

> **Status**: ✅ **DONE** — 8/8 tests PASS (2026-04-20)  
> **Prerequisite**: Phase 1 ✅ (Content-Based + Apriori complete, 5/5 tests PASS)  
> **Tham chiếu**: `implementation_plan.md` root → Section 2A.1 ~ 2A.6  
> **Kết quả**: Cosine Similarity, 206 pairs, 4 user persona clusters (500 users, 3735 interactions)

---

## Mục tiêu

Thêm tầng recommendation thứ 2 — **Item-based Collaborative Filtering**:

```
Phase 1 (done):  Content-Based (RAG)  + Apriori (co-purchase)  → "SP hay mua cùng"
Phase 2 (this):  Item-based CF         + Interaction Matrix     → "Users tương tự bạn cũng mua SP này"
```

**Khác biệt Apriori vs CF:**
| | Apriori | Item-based CF |
|---|---|---|
| Input | Tần suất mua chung | Vector hành vi mua của ALL users |
| Metric | Lift (surprise) | Adjusted Cosine Similarity |
| Câu hỏi | "A và B hay đi cùng?" | "Users thích A cũng thích B?" |
| Cold start | ✅ Chạy với 0 users | ❌ Cần đủ users (~500+) |

---

## Task Breakdown

### Task 1: Schema Migration

> Tham chiếu: `implementation_plan.md` → Section 2A.3

#### [MODIFY] `chatbot/src/db/init.sql`

```sql
-- User-item interaction matrix (built from order history)
CREATE TABLE IF NOT EXISTS user_product_interaction (
    user_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    store_id BIGINT NOT NULL,
    purchase_count INT DEFAULT 0,
    total_quantity INT DEFAULT 0,
    last_purchased_at TIMESTAMPTZ,
    interaction_score NUMERIC DEFAULT 0,   -- count × recency_weight
    PRIMARY KEY (user_id, product_id, store_id)
);

-- Pre-computed item similarity (nightly batch)
CREATE TABLE IF NOT EXISTS item_similarity (
    item_a BIGINT NOT NULL,
    item_b BIGINT NOT NULL,
    store_id BIGINT NOT NULL,
    similarity NUMERIC NOT NULL,           -- Adjusted Cosine [-1, 1]
    common_users INT DEFAULT 0,
    computed_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (item_a, item_b, store_id)
);

CREATE INDEX IF NOT EXISTS idx_item_sim_lookup
    ON item_similarity(item_a, store_id)
    WHERE similarity >= 0.3;

CREATE INDEX IF NOT EXISTS idx_interaction_user
    ON user_product_interaction(user_id, store_id);
```

---

### Task 2: Build Interaction Matrix

#### [NEW] `chatbot/src/services/cf.service.js`

```
CollaborativeFilteringService:

buildInteractionMatrix(storeId):
  1. Query sale_order_detail JOIN sale_order:
     GROUP BY customer_id, product_id → purchase_count, total_quantity
  2. Tính recency_weight = exp(-0.01 × days_since_last_purchase)
  3. interaction_score = purchase_count × recency_weight
  4. UPSERT user_product_interaction (batch)

computeItemSimilarities(storeId):
  1. Load matrix R[user][item] vào memory
  2. Tính R̄u (mean per user)
  3. Adjusted Cosine cho mỗi cặp items:
     sim(i,j) = Σ_u (R[u,i] - R̄u)(R[u,j] - R̄u) / 
                √(Σ_u (R[u,i] - R̄u)²) × √(Σ_u (R[u,j] - R̄u)²)
  4. Lưu item_similarity (chỉ sim >= 0.1, batch INSERT)

getRecommendations(userId, storeId, limit=5):
  1. Lấy items user đã mua
  2. Tìm similar items chưa mua (FROM item_similarity)
  3. prediction(u, i) = Σ sim(i,j) × R[u,j] / Σ |sim(i,j)|
  4. Sort → top K
```

**⚠ Edge Cases:**
- **Division by zero**: Nếu denominator = 0 → similarity = 0
- **Cold start user (0 orders)**: Fallback → Apriori + Content-Based
- **Sparse matrix**: Chỉ tính similarity cho items có ≥2 common users

---

### Task 3: Seed Interaction Data

#### [NEW] `docs/chatbot/seed-product/build-interactions.js`

Script tạo interaction matrix từ mock orders hiện tại:

```
Flow:
  1. Read sale_order + sale_order_detail (500 orders, 6280 rows)
  2. GROUP BY customer_id, product_id → purchase_count
  3. Tính recency_weight
  4. UPSERT user_product_interaction
  5. Call computeItemSimilarities()
```

---

### Task 4: RAG Pipeline Integration

#### [MODIFY] `rag.service.js`

Thêm Step 5.5 sau Co-purchase, trước Personalization:

```js
// Step 5.5: CF Enrichment (nếu có đủ data)
if (this.cfService && customerId) {
    const cfRecs = await this.cfService.getRecommendations(customerId, storeId, 3);
    if (cfRecs.length > 0) {
        metadata.steps.cf = { recommendations: cfRecs.length };
        // Inject CF suggestions vào generation prompt
    }
}
```

#### [MODIFY] `context.helper.js`

Thêm `getCFHint()`:

```
Output: "Dựa trên lịch sử mua hàng, bạn có thể thích: 
  Nấm kim châm (sim=0.85), Gia vị lẩu Thái (sim=0.72)"
```

---

### Task 5: Test Suite

#### [MODIFY] `test-algorithm.js`

3 test cases mới (từ `implementation_plan.md` → 2A.6):

| TC | Scenario | Expected | Metric |
|---|---|---|---|
| TC-CF-1 | User A mua [Bò, Nấm, GiaVị] 5x. User B mua [Bò, Nấm, ?] | Gợi ý GiaVị cho B | sim(GiaVị, Bò) > 0.5 |
| TC-CF-2 | User thường mua BữaSáng → hỏi "gợi ý" | SP BữaSáng chưa mua | prediction > 0.3 |
| TC-CF-3 | New user (cold start) | Fallback về Apriori | Graceful degradation |

---

## Execution Order

```
Step 1: Schema migration (init.sql)              → docker compose up --build
Step 2: cf.service.js (core algorithm)            → code
Step 3: build-interactions.js (seed data)         → node build-interactions.js  
Step 4: rag.service.js + context.helper.js        → integrate
Step 5: test-algorithm.js (add CF tests)          → node test-algorithm.js
```

---

## Blockers & Prerequisites

| Blocker | Status | Impact |
|---|---|---|
| **≥500 real users** | ❌ Hiện tại mock (auto-gen customers) | CF cần real user behavior |
| **Recency data** | ⚠️ Mock orders cùng ngày | recency_weight = 1.0 cho tất cả |
| **Phase 1 stable** | ✅ 5/5 tests pass | No blocker |

> **Gợi ý**: Có thể mock CF data tạm bằng cách sinh `user_product_interaction` trực tiếp
> với varied purchase_count + recency, không cần chờ production data.

---

## Verification

```bash
# 1. After building interactions
psql -c "SELECT COUNT(*) FROM user_product_interaction WHERE store_id = 1;"
psql -c "SELECT COUNT(*) FROM item_similarity WHERE store_id = 1 AND similarity >= 0.3;"

# 2. CF recommendations for a test user
psql -c "SELECT * FROM item_similarity 
  WHERE item_a = 1 AND store_id = 1 ORDER BY similarity DESC LIMIT 5;"

# 3. Full test suite (Phase 1 + Phase 2)
node docs/chatbot/seed-product/test-algorithm.js
# Expected: 8/8 PASS (5 Phase 1 + 3 Phase 2)
```
