/**
 * RAGService — Advanced RAG Pipeline
 * Step 1: Query Reformulation
 * Step 2: Embed query (Vietnamese SBERT)
 * Step 3: Hybrid Search (Semantic + Keyword in parallel)
 * Step 4: RRF Fusion → Top 5
 * Step 5: Co-purchase Enrichment
 * Step 6: Personalization
 * Step 5: Hybrid Ensemble (Phase 3: α×Content + β×CF + γ×Apriori + δ×Personal)
 * Step 6: Session Context Boost (Phase 3B: rule-based cluster detection)
 * Step 7: Augmented Generation (Qwen/Qwen2.5-7B-Instruct)
 */
const logger = require('../../../../shared/common/logger');
const { getPersonalizationContext, getCoPurchaseContext, getCFHint } = require('./context.helper');

class RAGService {
    constructor({ knowledgeRepo, copurchaseRepo, cfService, hybridService, sessionContextService, embeddingClient, hfClient, apiClient, reformulator }) {
        this.knowledgeRepo = knowledgeRepo;
        this.copurchaseRepo = copurchaseRepo;
        this.cfService = cfService || null;
        this.hybridService = hybridService || null;
        this.sessionContextService = sessionContextService || null;
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

            // ── Phase 3: Hybrid Ensemble (replaces separate CF/Apriori steps) ──
            let hybridResults = null;
            let sessionIntent = null;

            if (this.hybridService) {
                // Step 5: Hybrid Ensemble
                const stepStart5 = Date.now();
                const customerContext = await getPersonalizationContext(this.apiClient, customerId);

                hybridResults = await this.hybridService.score(
                    top5, customerId, storeId, customerContext.type
                );

                // Step 6: Session Context Boost
                if (this.sessionContextService && chatHistory.length > 0) {
                    const productSequence = this.sessionContextService.extractProductSequence(chatHistory);
                    sessionIntent = this.sessionContextService.inferSessionIntent(productSequence, userMessage);
                    if (sessionIntent) {
                        hybridResults = this.sessionContextService.applySessionBoost(hybridResults, sessionIntent);
                    }
                }

                metadata.steps.hybrid = {
                    engine: 'ensemble',
                    weights: this.hybridService.getWeights(),
                    resultCount: hybridResults.length,
                    sessionCluster: sessionIntent?.cluster || null,
                    latencyMs: Date.now() - stepStart5
                };
                metadata.steps.personalization = {
                    customerType: customerContext.type,
                    latencyMs: 0 // included in hybrid step
                };

                // Re-rank top5 by ensemble score
                const rankedIds = hybridResults.slice(0, 5).map(r => r.product_id);
                const enrichedTop5 = rankedIds.map(pid => {
                    const original = top5.find(r => Number(r.product_id) === pid);
                    const hybrid = hybridResults.find(r => r.product_id === pid);
                    return original
                        ? { ...original, ensemble_score: hybrid?.final_score, ensemble_sources: hybrid?.sources }
                        : hybrid?.rawProduct
                            ? { ...hybrid.rawProduct, ensemble_score: hybrid.final_score, ensemble_sources: hybrid.sources }
                            : null;
                }).filter(Boolean);

                // Use enriched results if available
                const finalProducts = enrichedTop5.length > 0 ? enrichedTop5 : top5;

                // Step 7: Augmented Generation
                const stepStart7 = Date.now();
                const coPurchaseData = await getCoPurchaseContext(this.copurchaseRepo, finalProducts, storeId);
                const response = await this._generateResponse(
                    userMessage, query, finalProducts, coPurchaseData, [], customerContext
                );
                metadata.steps.generation = { latencyMs: Date.now() - stepStart7 };

                const totalMs = Date.now() - startTime;
                metadata.totalLatencyMs = totalMs;
                logger.info({ storeId, customerId, totalMs, productCount: finalProducts.length, engine: 'hybrid' }, 'RAG pipeline completed');

                // Auto-track: record 'recommended' feedback for weight learning
                if (customerId && hybridResults.length > 0) {
                    for (const r of hybridResults.slice(0, 5)) {
                        this.hybridService.recordFeedback(
                            customerId, r.product_id, storeId,
                            r.topSource, 'recommended',
                            null, r.final_score
                        ).catch(() => {}); // fire-and-forget
                    }
                }

                return {
                    content: response.content,
                    productIds: finalProducts.map(r => r.product_id),
                    products: finalProducts.map(r => ({
                        id: r.product_id,
                        name: r.content?.match(/"([^"]+)"/)?.[1] || `Product ${r.product_id}`,
                        categoryName: r.category_name,
                        unitPrice: Number(r.unit_price),
                        quantityOnShelf: r.quantity_on_shelf,
                        rrfScore: r.rrf_score,
                        ensembleScore: r.ensemble_score,
                        ensembleSources: r.ensemble_sources
                    })),
                    metadata
                };
            }

            // ── Fallback: Phase 2 pipeline (no hybrid service) ──

            // Step 5: Co-purchase Enrichment
            const stepStart5 = Date.now();
            const coPurchaseData = await getCoPurchaseContext(this.copurchaseRepo, top5, storeId);
            metadata.steps.coPurchase = { latencyMs: Date.now() - stepStart5 };

            // Step 5.5: CF Enrichment (Phase 2 — if available)
            let cfData = [];
            if (this.cfService && customerId) {
                try {
                    const stepStartCF = Date.now();
                    cfData = await this.cfService.getRecommendations(customerId, storeId, 3);
                    metadata.steps.cf = {
                        recommendations: cfData.length,
                        latencyMs: Date.now() - stepStartCF
                    };
                } catch (err) {
                    logger.warn({ err }, 'CF enrichment failed — skipping');
                }
            }

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
                userMessage, query, top5, coPurchaseData, cfData, customerContext
            );
            metadata.steps.generation = { latencyMs: Date.now() - stepStart7 };

            const totalMs = Date.now() - startTime;
            metadata.totalLatencyMs = totalMs;

            logger.info({ storeId, customerId, totalMs, productCount: top5.length, engine: 'phase2-fallback' }, 'RAG pipeline completed');

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
    async _generateResponse(originalMessage, reformulatedQuery, products, coPurchaseData, cfData, customerContext) {
        const productContext = products.map((p, i) => {
            const name = p.content.match(/"([^"]+)"/)?.[1] || `Product ${p.product_id}`;
            return `${i + 1}. ${name} — ${p.category_name}, ${Number(p.unit_price).toLocaleString('vi-VN')}đ, còn ${p.quantity_on_shelf} sản phẩm`;
        }).join('\n');

        let coPurchaseContext = '';
        if (coPurchaseData.length > 0) {
            coPurchaseContext = '\n\nSản phẩm thường mua kèm (Apriori):\n' +
                coPurchaseData.map(cp => {
                    const items = cp.relatedProducts.map(r => {
                        const conf = Number(r.confidence) > 0
                            ? ` (${Math.round(r.confidence * 100)}% mua kèm)`
                            : '';
                        return `Product #${r.product_id_b}${conf}`;
                    });
                    return `- Khách mua "${cp.productName}" thường mua kèm: ${items.join(', ')}`;
                }).join('\n');
        }

        let cfContext = '';
        if (cfData.length > 0) {
            cfContext = '\n\nGợi ý cá nhân hóa (dựa trên lịch sử mua):\n' +
                cfData.map(r => `- Product #${r.product_id} (điểm phù hợp: ${r.prediction_score})`).join('\n');
        }

        const systemPrompt = `Bạn là nhân viên tư vấn siêu thị POSMART. Trả lời bằng tiếng Việt, thân thiện, ngắn gọn.
CHỈ sử dụng dữ liệu sản phẩm được cung cấp bên dưới. KHÔNG bịa thêm sản phẩm hay giá.
${customerContext.prompt}

Dữ liệu sản phẩm phù hợp:
${productContext}${coPurchaseContext}${cfContext}`;

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
