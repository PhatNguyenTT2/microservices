# KỊCH BẢN THUYẾT TRÌNH BẢO VỆ ĐỒ ÁN

> **Dự kiến**: 15-20 phút

---

## I. Mở đầu & Đặt vấn đề (2 phút)

"Kính thưa Hội đồng,

Đề tài của em là **'Hệ Thống Gợi Ý Sản Phẩm AI — POSMART'**. Khác với các chatbot hỏi đáp thông thường, mục tiêu của em là biến chatbot thành một **nhân viên bán hàng chủ động**.

Thay vì sử dụng một thuật toán gợi ý duy nhất thường mang nhiều điểm mù, em đã thiết kế một **Kiến trúc Gợi ý Lai (Hybrid Ensemble)**. Điểm khác biệt cốt lõi của hệ thống này là khả năng **tự động điều chỉnh trọng số học hỏi (Adaptive Weight Learning)** dựa trên hành vi mua hàng thực tế của người dùng, biến nó thành một vòng lặp khép kín từ gợi ý đến chốt đơn."

---

## II. Phân tích: Tại sao lại chọn tổ hợp thuật toán này? (3 phút)

"Trước khi đi sâu vào chi tiết, em xin phép trình bày lý do tại sao em chọn tổ hợp 4 thành phần (Content, Apriori, CF, Rule-based) thay vì dùng thẳng các mô hình Deep Learning phức tạp.

Sự lựa chọn này dựa trên bài toán đánh đổi giữa **Độ phức tạp (Complexity)** và **Độ chính xác thương mại (Business Accuracy)**:"

### Bảng so sánh Trade-off: Hybrid Ensemble vs. Deep Learning

| Tiêu chí | Hybrid Ensemble (của em) | Deep Learning (Matrix Factorization / Neural CF) |
|---|---|---|
| **Dữ liệu cần thiết** | Hoạt động từ ngày đầu (RAG) | Cần hàng triệu tương tác để hội tụ |
| **Cold-start** | ✅ RAG giải quyết ngay lập tức | ❌ Không thể gợi ý cho user/item mới |
| **Explainability** | ✅ White-box: giải thích được tại sao | ❌ Black-box: không giải thích được |
| **Tài nguyên** | CPU đủ dùng, nightly batch | Cần GPU, training liên tục |
| **Độ chính xác** | Tốt cho quy mô siêu thị mini | Vượt trội khi có Big Data |
| **Thời gian phát triển** | Tuần | Tháng |

### 3 lý do chính

1. **Vấn đề Cold-start (Đói dữ liệu):** Các mô hình Deep Learning cần hàng triệu tương tác để hội tụ. Trong môi trường siêu thị mini, em sử dụng **RAG (Content-based)** để giải quyết ngay lập tức việc gợi ý cho khách hàng mới mà không cần dữ liệu lịch sử.

2. **Khả năng giải thích (Explainability):** Các thuật toán như Apriori hay Item-based CF mang tính minh bạch cao (White-box). Hệ thống có thể giải thích chính xác *tại sao* sản phẩm A được đẩy lên Top: *'Vì 60% khách hàng mua Bò cũng mua Nấm'*. Điều này giúp admin dễ dàng can thiệp và gỡ lỗi.

3. **Độ phức tạp tính toán (Computational Complexity):** Thay vì chạy các matrix factorization nặng nề theo thời gian thực, kiến trúc của em đưa phần tính toán nặng (Apriori, CF Similarity, Weight Learning) về chạy ngầm vào lúc **2:00 sáng (Nightly Batch)**. Khi runtime, hệ thống chỉ cần truy xuất dữ liệu In-memory với độ trễ cực thấp.

---

## III. Đi sâu vào từng Thuật toán (8 phút)

"Sau đây, em xin đi chi tiết vào 4 trụ cột thuật toán của hệ thống."

### 1. Trụ cột 1: Content-Based Filtering với RAG và RRF (α)

- **Bản chất:** Tìm sản phẩm khớp với câu hỏi của khách hàng nhất.
- **Chi tiết triển khai:** Em không chỉ dùng Semantic Search (tìm theo ý nghĩa). Câu hỏi được đưa qua 2 luồng:
  - **Semantic Search** dùng Vector 768 chiều qua index HNSW của pgvector
  - **Keyword Search** dùng Full-Text Search (GIN index)

#### Phân tích Độ phức tạp (Complexity Analysis)

| Thành phần | Độ phức tạp | Giải thích |
|---|---|---|
| HNSW Semantic Search | **O(log n)** | Cấu trúc đồ thị phân tầng, chỉ duyệt log(n) node thay vì quét toàn bộ n vectors |
| GIN Full-Text Search | **O(k)** | k = số token khớp, nhờ inverted index tra cứu trực tiếp |
| RRF Fusion | **O(m log m)** | m = tổng kết quả từ 2 luồng (tối đa 20), sort merge |
| **Tổng runtime** | **O(log n)** | HNSW chiếm ưu thế, các bước còn lại là hằng số nhỏ |

> So sánh: Brute-force vector scan là **O(n)** với n = số sản phẩm. Với 10,000 sản phẩm, HNSW chỉ cần ~13 phép so sánh thay vì 10,000.

#### Điểm nhấn: Tại sao RRF chọn Top 5 mà không phải Top 10?

"Đây là một quyết định thiết kế quan trọng dựa trên 4 yếu tố:"

| # | Yếu tố | Top 5 | Top 10 | Lý do chọn Top 5 |
|---|---|---|---|---|
| 1 | **Chất lượng Ensemble** | Tất cả candidates đều có RRF score đủ cao | Candidates rank 6-10 thường chỉ xuất hiện ở 1 trong 2 luồng, score rất thấp | Ensemble scoring nhân trọng số → noise từ candidates yếu bị khuếch đại |
| 2 | **LLM Context Window** | ~500 tokens product context | ~1,000 tokens product context | Prompt ngắn hơn → LLM tập trung trả lời chính xác hơn, giảm hallucination |
| 3 | **Latency** | CF lookup 5 items × similarity matrix | CF lookup 10 items × similarity matrix | Mỗi candidate cần query Apriori + CF → gấp đôi thời gian I/O |
| 4 | **UX ngành bán lẻ** | Khách hàng xem hết 5 sản phẩm | Khách hàng bỏ qua sau 3-5 sản phẩm | Nghiên cứu UX cho thấy attention span trên chat interface rất ngắn |

**Phân tích định lượng — RRF Score Decay:**

```
Candidate rank 1:  1/61 + 1/61 = 0.0328  (xuất hiện ở cả 2 luồng)
Candidate rank 5:  1/65 + 1/66 = 0.0305  (vẫn xuất hiện ở cả 2 luồng)
Candidate rank 6:  1/67 + 0    = 0.0149  (chỉ xuất hiện ở 1 luồng)
                   ↑ Score giảm 51% so với rank 5
Candidate rank 10: 1/71 + 0    = 0.0141  (chỉ xuất hiện ở 1 luồng)
```

> **Kết luận:** Từ rank 6 trở đi, RRF score giảm đột ngột ~51% vì hầu hết chỉ xuất hiện ở 1 luồng tìm kiếm. Đưa các candidates này vào Ensemble sẽ tạo **nhiễu (noise)** thay vì giá trị, vì Content score đã rất thấp nhưng Apriori/CF có thể đẩy lên bất hợp lý.

**Hằng số k=60:** Giá trị `k=60` là hằng số chuẩn được đề xuất trong bài báo gốc về RRF (Cormack et al., 2009). Vai trò của `k` là cân bằng ảnh hưởng giữa các thứ hạng: giá trị `k` lớn giúp giảm sự chênh lệch điểm số giữa rank 1 và rank 10, tránh tình trạng kết quả rank cao ở 1 danh sách hoàn toàn áp đảo.

---

### 2. Trụ cột 2: Luật Kết hợp Apriori (γ)

- **Bản chất:** Bán chéo (Cross-sell) bằng cách tìm ra các sản phẩm thường được mua chung trong một giỏ hàng.
- **Chi tiết triển khai:** Em lưu trữ tần suất mua chung trong bảng `co_purchase_stats`. Thay vì chỉ dùng Support hay Confidence, hệ thống sử dụng **Lift** làm thước đo quyết định.

**Công thức:**

$$lift(A,B) = \frac{count(A \wedge B) \times |T|}{count(A) \times count(B)}$$

#### Phân tích Độ phức tạp

| Giai đoạn | Độ phức tạp | Khi nào chạy |
|---|---|---|
| Tính co_purchase pairs | **O(Σ C(k,2))** với k = items/đơn | Nightly batch 2AM |
| Tính support/confidence/lift | **O(p)** với p = số cặp | Nightly batch 2AM |
| **Runtime lookup** | **O(1)** nhờ B-Tree index | Khi user hỏi chatbot |

> Batch nặng nhất là O(Σ C(k,2)). Với trung bình k=5 items/đơn → C(5,2)=10 cặp/đơn. 1,000 đơn → 10,000 phép tính. Hoàn toàn khả thi cho nightly batch.

- **Độ chính xác:** Nhờ **Partial Index `WHERE lift > 1`**, hệ thống chỉ lọc ra những cặp có tương quan dương thực sự, loại bỏ hoàn toàn các sản phẩm nhiễu (noise) được mua ngẫu nhiên.

---

### 3. Trụ cột 3: Item-based Collaborative Filtering (β)

- **Bản chất:** Gợi ý dựa trên sự tương đồng về hành vi mua của đám đông.
- **Chi tiết triển khai:** Hệ thống xây dựng ma trận tương tác giữa User và Product. Điểm tương tác (R[u,i]) được tính toán dựa trên số lần mua, số lượng và độ mới (recency decay).

#### Phân tích Độ phức tạp

| Giai đoạn | Độ phức tạp | Giải thích |
|---|---|---|
| Xây dựng ma trận R[u,i] | **O(n)** với n = số interactions | Đọc từ DB, lưu vào Map |
| Tính norm ‖R[*,i]‖ | **O(m × avg_users)** | m = số items |
| Cosine Similarity all pairs | **O(m² × avg_common)** | Tệ nhất, nhưng có pruning |
| Pruning: `common_users < 2` | Giảm ~70-80% cặp | Skip cặp ít user chung |
| **Runtime prediction** | **O(k)** với k = items user đã mua | Lookup pre-computed similarity |

> **Bottleneck:** O(m²) cho Cosine pairs. Với m=200 sản phẩm → 19,900 cặp. Pruning giảm xuống ~4,000 cặp. Chạy <5 giây trong nightly batch.

**Bảo vệ quyết định thuật toán — Tại sao Plain Cosine thay vì Adjusted Cosine?**

| | Plain Cosine | Adjusted Cosine |
|---|---|---|
| Công thức | `sim = Σ R[u,i]×R[u,j] / (‖i‖×‖j‖)` | `sim = Σ (R[u,i]-μ_u)×(R[u,j]-μ_u) / ...` |
| Phù hợp với | **Implicit Feedback** (purchase count) | Explicit Feedback (rating 1-5) |
| Vấn đề với data của em | Không có | Trừ mean → triệt tiêu magnitude → `sim ≈ 0` |

Vì dữ liệu siêu thị là **'Implicit Feedback'** (phản hồi ngầm từ số lần mua). Việc dùng Adjusted Cosine để trừ đi số mean sẽ vô tình triệt tiêu độ lớn của hành vi mua lặp lại liên tục, làm sai lệch kết quả.

---

### 4. Trụ cột 4: Hybrid Ensemble và Adaptive Weight Learning

"Đây là **trái tim** của hệ thống."

3 điểm số từ RAG, Apriori và CF được chuẩn hóa Min-Max và nhân với 4 trọng số: α, β, γ và δ (đại diện cho Session Personalization).

**Làm sao hệ thống biết trọng số nào là tốt nhất?** Em đã thiết kế một **vòng lặp phản hồi (Feedback Loop):**

1. Mọi tương tác từ lúc **Gợi ý → Click → Vào giỏ → Mua hàng** (trong 24h) đều được ghi nhận vào bảng `recommendation_feedback`.

2. Vào **2:00 AM mỗi đêm**, Job WeightLearner sẽ tính toán lại tỷ lệ chuyển đổi (Conversion Rate) cho từng nguồn bằng công thức:

$$score(source) = purchased \times 1.0 + added\_to\_cart \times 0.5 + clicked \times 0.2$$

3. Để giữ cho mô hình ổn định, em áp dụng kỹ thuật **Exponential Smoothing**:

$$smoothed = 0.8 \times current\_weight + 0.2 \times raw\_weight$$

> Điều này giúp AI học từ cái mới nhưng không quên đi dữ liệu lịch sử cốt lõi.

#### Phân tích Độ phức tạp Weight Learning

| Bước | Độ phức tạp | Giải thích |
|---|---|---|
| Aggregate feedback by source | **O(f)** với f = số feedback records | SQL GROUP BY |
| Tính conversion rate | **O(3)** = O(1) | 3 sources cố định |
| Exponential smoothing | **O(1)** | Phép nhân hằng số |
| Clamping + normalize | **O(1)** | 3 phép so sánh |
| **Tổng** | **O(f)** | Nhanh, dù có hàng nghìn feedbacks |

---

## IV. Đánh giá Tổng thể Hệ thống (3 phút)

### 4.1 Bảng đánh giá Độ chính xác theo từng thuật toán

| Thuật toán | Metric đánh giá | Giá trị mục tiêu | Cách đo | Điểm mạnh | Điểm yếu |
|---|---|---|---|---|---|
| **RAG + RRF** | Precision@5 (tỷ lệ sản phẩm đúng trong top 5) | ≥ 80% | So sánh kết quả RRF với ground truth từ category matching | Giải quyết cold-start, không cần lịch sử | Phụ thuộc chất lượng embedding model |
| **Apriori** | Lift > 1 rate (tỷ lệ cặp có tương quan dương) | ≥ 60% cặp | Partial index `WHERE lift > 1` / tổng cặp | Giải thích được, cross-sell hiệu quả | Cần đủ đơn hàng (≥50) để có ý nghĩa thống kê |
| **CF** | Hit Rate@5 (user có mua ít nhất 1 sản phẩm gợi ý) | ≥ 40% | Feedback `action='purchased'` / tổng recommendations từ CF | Cá nhân hóa theo hành vi thực tế | Cold-start cho user mới (fallback về RAG) |
| **Ensemble** | Conversion Rate (gợi ý → mua hàng) | ≥ 5% | `purchased_count / recommended_count` từ feedback table | Kết hợp ưu điểm cả 3 thuật toán | Complexity trong debugging multi-source |

### 4.2 Bảng Tổng hợp Độ phức tạp toàn hệ thống

| Thành phần | Offline (Nightly Batch) | Online (Runtime) | Memory |
|---|---|---|---|
| RAG + RRF | N/A (embedding sync O(n)) | **O(log n)** HNSW + O(k) FTS | ~50MB vectors |
| Apriori | **O(Σ C(k,2))** per order | **O(1)** index lookup | ~1MB co_purchase table |
| CF Similarity | **O(m²)** pairs (pruned) | **O(k)** prediction | ~5MB similarity matrix |
| Weight Learning | **O(f)** feedback scan | N/A | Negligible |
| Session Context | N/A | **O(p)** with p = products in result | ~1KB cluster rules |
| **Tổng Runtime** | — | **< 500ms P95** | ~56MB |

### 4.3 So sánh với các phương pháp khác

| Tiêu chí | POSMART (Hybrid Ensemble) | Pure CF (Netflix-style) | Deep Learning (NCF) | Rule-based cứng |
|---|---|---|---|---|
| Cold-start | ✅ RAG fallback | ❌ Không hoạt động | ❌ Cần training data | ✅ Không cần data |
| Explainability | ✅ White-box | ⚠️ Hạn chế | ❌ Black-box | ✅ Hoàn toàn |
| Scalability | ⚠️ O(m²) batch | ✅ Matrix factorization | ✅ Tốt | ✅ O(1) |
| Accuracy (big data) | ⚠️ Tốt ở quy mô nhỏ-trung | ✅ Tốt | ✅✅ Rất tốt | ❌ Thấp |
| Adaptiveness | ✅ Weight Learning | ❌ Tĩnh | ✅ Re-training | ❌ Cố định |
| Phù hợp siêu thị mini | ✅✅ Tối ưu | ❌ Thiếu data | ❌ Overkill | ⚠️ Quá đơn giản |

---

## V. Phương án Cải tiến trong Tương lai (3 phút)

"Kính thưa Hội đồng, hệ thống hiện tại được tối ưu hóa cho giai đoạn 'Khởi động' của một doanh nghiệp. Để hệ thống có thể mở rộng (Scale) lên mức hàng triệu tương tác, em đề xuất 3 phương án cải tiến sau:"

1. **Từ Rule-based lên Sequence-Aware Deep Learning:** Hiện tại, Session Personalization (δ) chỉ dùng Rule-based cứng để cộng điểm (Ví dụ: +0.15 cho cụm Lẩu Bò). Tương lai, em sẽ thay thế bằng kiến trúc **Mạng nơ-ron hồi quy (GRU) hoặc Transformer** để AI tự động học chuỗi hành vi lướt web của khách hàng theo thời gian thực.

2. **Từ Exponential Smoothing lên Reinforcement Learning:** Thay vì dùng trung bình nhân để học trọng số chung cho toàn hệ thống vào ban đêm, có thể áp dụng thuật toán **Contextual Multi-Armed Bandit (LinUCB)**. Khi đó, trọng số α, β, γ sẽ được tính toán lại theo thời gian thực (Real-time) và cá nhân hóa cho riêng từng khách hàng dựa trên ngữ cảnh lúc đó.

3. **Tích hợp thêm Graph Database:** Với các luật kết hợp từ Apriori, việc chuyển dữ liệu sang CSDL Đồ thị (như Neo4j) sẽ giúp hệ thống tìm ra các chuỗi liên kết gián tiếp (A liên quan B, B liên quan C → gợi ý C cho A) với độ phức tạp truy vấn thấp hơn nhiều so với JOIN trong PostgreSQL.

---

## VI. Kết luận (2 phút)

"Qua Testcase End-to-End, hệ thống đã chứng minh được khả năng:
- Tiếp nhận câu hỏi tự nhiên
- Tổng hợp điểm số từ đa nguồn
- Bắt ngữ cảnh (Cluster `lau_bo`)
- Tự động ghi nhận chuyển đổi thành công

Sự kết hợp giữa **RAG Database**, **thuật toán khai phá dữ liệu** và **vòng lặp tự học** đã giúp POSMART vượt qua giới hạn của một chatbot hỏi-đáp thông thường, trở thành một **công cụ thúc đẩy doanh số thực sự**.

Em xin chân thành cảm ơn Hội đồng đã lắng nghe. Sau đây, em xin phép demo hệ thống AI Dashboard và cấu trúc dữ liệu, đồng thời sẵn sàng nhận các câu hỏi phản biện từ Quý Thầy Cô."