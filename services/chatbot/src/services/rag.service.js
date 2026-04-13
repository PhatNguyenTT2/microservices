/**
 * RAGService — Advanced RAG Pipeline
 * Step 1: Query Reformulation
 * Step 2: Embed query (Vietnamese SBERT)
 * Step 3: Hybrid Search (Semantic + Keyword in parallel)
 * Step 4: RRF Fusion → Top 5
 * Step 5: Co-purchase Enrichment
 * Step 6: Personalization
 * Step 7: Augmented Generation (Qwen/Qwen2.5-7B-Instruct)
 */
const logger = require('../../../../shared/common/logger');
const { getPersonalizationContext, getCoPurchaseContext } = require('./context.helper');

class RAGService {
    constructor({ knowledgeRepo, copurchaseRepo, embeddingClient, hfClient, apiClient, reformulator }) {
        this.knowledgeRepo = knowledgeRepo;
        this.copurchaseRepo = copurchaseRepo;
        this.embeddingClient = embeddingClient;
        this.hfClient = hfClient;
        this.apiClient = apiClient;
        this.reformulator = reformulator;
    }

    /**
     * Main RAG pipeline — recommend products
     * @param {string} userMessage - original user message
     * @param {number} storeId - current store (multi-tenancy)
     * @param {number|null} customerId - for personalization
     * @param {object[]} chatHistory - recent chat messages
     * @returns {object} { content, productIds, products, metadata }
     */
    async recommend(userMessage, storeId, customerId = null, chatHistory = []) {
        const startTime = Date.now();
        const metadata = { steps: {} };

        try {
            // Step 1: Query Reformulation
            const stepStart1 = Date.now();
            const query = await this.reformulator.reformulate(userMessage, chatHistory);
            metadata.steps.reformulation = {
                original: userMessage,
                reformulated: query,
                changed: query !== userMessage,
                latencyMs: Date.now() - stepStart1
            };

            // Step 2: Embed query
            const stepStart2 = Date.now();
            const queryVector = await this.embeddingClient.embed(query);
            metadata.steps.embedding = { latencyMs: Date.now() - stepStart2 };

            // Step 3: Hybrid Search (parallel)
            const stepStart3 = Date.now();
            const [semanticResults, keywordResults] = await Promise.all([
                this.knowledgeRepo.searchSemantic(queryVector, storeId, 10),
                this.knowledgeRepo.searchKeyword(query, storeId, 10)
            ]);
            metadata.steps.search = {
                semanticCount: semanticResults.length,
                keywordCount: keywordResults.length,
                latencyMs: Date.now() - stepStart3
            };

            // Step 4: RRF Fusion
            const fused = this._reciprocalRankFusion(semanticResults, keywordResults);
            const top5 = fused.slice(0, 5);

            metadata.steps.fusion = {
                totalCandidates: fused.length,
                top5Scores: top5.map(r => ({ productId: r.product_id, rrfScore: r.rrf_score.toFixed(4) }))
            };

            if (top5.length === 0) {
                return this._buildNoResultsResponse(userMessage, storeId, startTime, metadata);
            }

            // Step 5: Co-purchase Enrichment
            const stepStart5 = Date.now();
            const coPurchaseData = await getCoPurchaseContext(this.copurchaseRepo, top5, storeId);
            metadata.steps.coPurchase = { latencyMs: Date.now() - stepStart5 };

            // Step 6: Personalization
            const stepStart6 = Date.now();
            const customerContext = await getPersonalizationContext(this.apiClient, customerId);
            metadata.steps.personalization = {
                customerType: customerContext.type,
                latencyMs: Date.now() - stepStart6
            };

            // Step 7: Augmented Generation
            const stepStart7 = Date.now();
            const response = await this._generateResponse(
                userMessage, query, top5, coPurchaseData, customerContext
            );
            metadata.steps.generation = { latencyMs: Date.now() - stepStart7 };

            const totalMs = Date.now() - startTime;
            metadata.totalLatencyMs = totalMs;

            logger.info({ storeId, customerId, totalMs, productCount: top5.length }, 'RAG pipeline completed');

            return {
                content: response.content,
                productIds: top5.map(r => r.product_id),
                products: top5.map(r => ({
                    id: r.product_id,
                    name: r.content.match(/"([^"]+)"/)?.[1] || `Product ${r.product_id}`,
                    categoryName: r.category_name,
                    unitPrice: Number(r.unit_price),
                    quantityOnShelf: r.quantity_on_shelf,
                    rrfScore: r.rrf_score
                })),
                metadata
            };
        } catch (err) {
            logger.error({ err, storeId, userMessage }, 'RAG pipeline error');
            return {
                content: 'Xin lỗi, hệ thống đang gặp sự cố khi tìm kiếm sản phẩm. Vui lòng thử lại sau.',
                productIds: [],
                products: [],
                metadata: { error: err.message, totalLatencyMs: Date.now() - startTime }
            };
        }
    }

    /**
     * Reciprocal Rank Fusion: score(d) = SUM(1 / (k + rank))
     * Items appearing in both lists get higher combined scores
     */
    _reciprocalRankFusion(semanticList, keywordList, k = 60) {
        const scoreMap = new Map();

        semanticList.forEach((item, rank) => {
            const key = `${item.product_id}_${item.store_id}`;
            if (!scoreMap.has(key)) {
                scoreMap.set(key, { score: 0, item });
            }
            scoreMap.get(key).score += 1 / (k + rank + 1);
        });

        keywordList.forEach((item, rank) => {
            const key = `${item.product_id}_${item.store_id}`;
            if (!scoreMap.has(key)) {
                scoreMap.set(key, { score: 0, item });
            }
            scoreMap.get(key).score += 1 / (k + rank + 1);
        });

        return [...scoreMap.values()]
            .sort((a, b) => b.score - a.score)
            .map(v => ({ ...v.item, rrf_score: v.score }));
    }



    /**
     * Generate natural language response using Qwen/Qwen2.5-7B-Instruct
     */
    async _generateResponse(originalMessage, reformulatedQuery, products, coPurchaseData, customerContext) {
        const productContext = products.map((p, i) => {
            const name = p.content.match(/"([^"]+)"/)?.[1] || `Product ${p.product_id}`;
            return `${i + 1}. ${name} — ${p.category_name}, ${Number(p.unit_price).toLocaleString('vi-VN')}đ, còn ${p.quantity_on_shelf} sản phẩm`;
        }).join('\n');

        let coPurchaseContext = '';
        if (coPurchaseData.length > 0) {
            coPurchaseContext = '\n\nSản phẩm thường mua kèm:\n' +
                coPurchaseData.map(cp =>
                    `- Khách mua "${cp.productName}" thường mua kèm: ${cp.relatedProducts.map(r => `Product #${r.product_id_b}`).join(', ')}`
                ).join('\n');
        }

        const systemPrompt = `Bạn là nhân viên tư vấn siêu thị POSMART. Trả lời bằng tiếng Việt, thân thiện, ngắn gọn.
CHỈ sử dụng dữ liệu sản phẩm được cung cấp bên dưới. KHÔNG bịa thêm sản phẩm hay giá.
${customerContext.prompt}

Dữ liệu sản phẩm phù hợp:
${productContext}${coPurchaseContext}`;

        try {
            // Use raw HF client to inject custom RAG system prompt
            const response = await this.hfClient.client.chatCompletion({
                model: this.hfClient.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: originalMessage }
                ],
                max_tokens: 400,
                temperature: 0.6
            });

            const reply = response.choices?.[0]?.message?.content;
            if (reply) return { content: reply };

            return { content: this._buildFallbackResponse(products, customerContext) };
        } catch (err) {
            logger.error({ err }, 'LLM generation failed — returning formatted fallback');
            return {
                content: this._buildFallbackResponse(products, customerContext)
            };
        }
    }

    /**
     * Fallback when LLM fails — structured text response
     */
    _buildFallbackResponse(products, customerContext) {
        const greeting = customerContext.type === 'vip'
            ? 'Chào anh/chị (khách VIP)! Dưới đây là sản phẩm gợi ý:'
            : 'Chào bạn! Dưới đây là sản phẩm phù hợp:';

        const items = products.map((p, i) => {
            const name = p.content.match(/"([^"]+)"/)?.[1] || `Sản phẩm #${p.product_id}`;
            return `  ${i + 1}. ${name} — ${Number(p.unit_price).toLocaleString('vi-VN')}đ (còn ${p.quantity_on_shelf} trên kệ)`;
        }).join('\n');

        return `${greeting}\n${items}\n\nCác sản phẩm trên đều đang có sẵn tại chi nhánh của bạn!`;
    }

    /**
     * Handle case when no products found
     */
    _buildNoResultsResponse(userMessage, storeId, startTime, metadata) {
        metadata.totalLatencyMs = Date.now() - startTime;
        return {
            content: `Xin lỗi, mình không tìm thấy sản phẩm phù hợp với "${userMessage}" tại chi nhánh của bạn. Bạn có thể mô tả chi tiết hơn được không?`,
            productIds: [],
            products: [],
            metadata
        };
    }
}

module.exports = RAGService;
