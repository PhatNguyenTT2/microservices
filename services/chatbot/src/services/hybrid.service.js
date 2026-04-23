/**
 * HybridRecommendationService — Phase 3 Ensemble Scoring
 * 
 * Hợp nhất 3 engines thành 1 điểm số duy nhất:
 *   final_score = α×content + β×cf + γ×apriori + δ×personalization
 * 
 * Tối ưu theo feedback:
 *   - In-memory cache cho CF + Apriori (load 1 lần, dùng mãi)
 *   - Local Max normalization cho RRF (max của query hiện tại)
 *   - Graceful fallback khi engine nào fail
 */
const logger = require('../../../../shared/common/logger');

const DEFAULT_WEIGHTS = { alpha: 0.40, beta: 0.25, gamma: 0.25, delta: 0.10 };

class HybridRecommendationService {
    constructor({ copurchaseRepo, cfService, pool }) {
        this.copurchaseRepo = copurchaseRepo;
        this.cfService = cfService;
        this.pool = pool;

        // In-memory caches (loaded at warmUp, refreshed nightly)
        this._cfCache = new Map();       // `${userId}_${storeId}` → recommendations[]
        this._aprioriCache = new Map();  // `${productId}_${storeId}` → relatedProducts[]
        this._weights = { ...DEFAULT_WEIGHTS };
        this._cacheReady = false;
    }

    /**
     * Warm up caches — call once at startup or after nightly batch
     */
    async warmUp(storeId) {
        const start = Date.now();
        try {
            // Load ensemble weights
            const { rows } = await this.pool.query(
                'SELECT alpha, beta, gamma, delta FROM ensemble_weights WHERE store_id = $1',
                [storeId]
            );
            if (rows.length > 0) {
                this._weights = {
                    alpha: Number(rows[0].alpha),
                    beta: Number(rows[0].beta),
                    gamma: Number(rows[0].gamma),
                    delta: Number(rows[0].delta)
                };
            }

            // Pre-load top Apriori pairs into cache
            const { rows: aprioriRows } = await this.pool.query(`
                SELECT product_id_a, product_id_b, co_purchase_count,
                       confidence_ab, confidence_ba, lift
                FROM co_purchase_stats
                WHERE store_id = $1 AND lift > 1
                ORDER BY lift DESC
            `, [storeId]);

            this._aprioriCache.clear();
            for (const row of aprioriRows) {
                const keyA = `${row.product_id_a}_${storeId}`;
                const keyB = `${row.product_id_b}_${storeId}`;

                if (!this._aprioriCache.has(keyA)) this._aprioriCache.set(keyA, []);
                this._aprioriCache.get(keyA).push({
                    product_id: Number(row.product_id_b),
                    confidence: Number(row.confidence_ab) || 0,
                    lift: Number(row.lift) || 0
                });

                if (!this._aprioriCache.has(keyB)) this._aprioriCache.set(keyB, []);
                this._aprioriCache.get(keyB).push({
                    product_id: Number(row.product_id_a),
                    confidence: Number(row.confidence_ba) || 0,
                    lift: Number(row.lift) || 0
                });
            }

            // Pre-load item similarities for CF lookups
            const { rows: simRows } = await this.pool.query(`
                SELECT item_a, item_b, similarity
                FROM item_similarity
                WHERE store_id = $1 AND similarity >= 0.1
            `, [storeId]);

            this._cfCache.clear();
            this._cfCache.set('_similarities', simRows.map(r => ({
                itemA: Number(r.item_a),
                itemB: Number(r.item_b),
                similarity: Number(r.similarity)
            })));

            this._cacheReady = true;
            const elapsed = Date.now() - start;
            logger.info({
                storeId,
                weights: this._weights,
                aprioriPairs: aprioriRows.length,
                cfPairs: simRows.length,
                elapsed: `${elapsed}ms`
            }, 'Hybrid: Cache warmed up');
        } catch (err) {
            logger.error({ err }, 'Hybrid: Cache warmup failed — will use DB fallback');
        }
    }

    /**
     * Ensemble scoring — merges Content, CF, Apriori scores
     * 
     * @param {object[]} contentResults - RAG RRF results (product_id, rrf_score, ...)
     * @param {number|null} userId - for CF personalization
     * @param {number} storeId
     * @param {string} customerType - 'vip'|'wholesale'|'retail'
     * @returns {object[]} products sorted by final_score
     */
    async score(contentResults, userId, storeId, customerType = 'retail') {
        const { alpha, beta, gamma, delta } = this._weights;
        const scoreMap = new Map(); // productId → { content, cf, apriori, personal, sources }

        // ── Step 1: Content scores (Local Max normalization) ──
        const maxRRF = contentResults.length > 0
            ? Math.max(...contentResults.map(r => r.rrf_score || 0))
            : 1;

        for (const r of contentResults) {
            const pid = Number(r.product_id);
            const normalizedContent = maxRRF > 0 ? (r.rrf_score || 0) / maxRRF : 0;

            scoreMap.set(pid, {
                content: normalizedContent,
                cf: 0,
                apriori: 0,
                personal: 0,
                sources: ['content'],
                rawProduct: r
            });
        }

        // ── Step 2: CF scores ──
        let cfResults = [];
        if (userId && beta > 0) {
            try {
                cfResults = await this.cfService.getRecommendations(userId, storeId, 10);
            } catch (err) {
                logger.warn({ err }, 'Hybrid: CF engine failed');
            }
        }

        if (cfResults.length > 0) {
            const maxCF = Math.max(...cfResults.map(r => r.prediction_score));
            for (const r of cfResults) {
                const pid = r.product_id;
                const normalizedCF = maxCF > 0 ? r.prediction_score / maxCF : 0;

                if (scoreMap.has(pid)) {
                    scoreMap.get(pid).cf = normalizedCF;
                    scoreMap.get(pid).sources.push('cf');
                } else {
                    // CF-only product (not in content results)
                    scoreMap.set(pid, {
                        content: 0, cf: normalizedCF, apriori: 0, personal: 0,
                        sources: ['cf'], rawProduct: null
                    });
                }
            }
        }

        // ── Step 3: Apriori scores (from cache or DB) ──
        if (gamma > 0) {
            const contentProductIds = contentResults.map(r => Number(r.product_id));
            const aprioriCandidates = new Map(); // productId → maxConfidence

            for (const pid of contentProductIds) {
                const cacheKey = `${pid}_${storeId}`;
                let related = this._aprioriCache.get(cacheKey);

                if (!related && !this._cacheReady) {
                    // Fallback to DB
                    try {
                        related = await this.copurchaseRepo.getRelatedProducts(pid, storeId, 5);
                        related = related.map(r => ({
                            product_id: Number(r.product_id_b),
                            confidence: Number(r.confidence) || 0,
                            lift: Number(r.lift) || 0
                        }));
                    } catch (err) {
                        related = [];
                    }
                }

                if (related) {
                    for (const rel of related) {
                        const existingConf = aprioriCandidates.get(rel.product_id) || 0;
                        if (rel.confidence > existingConf) {
                            aprioriCandidates.set(rel.product_id, rel.confidence);
                        }
                    }
                }
            }

            for (const [pid, confidence] of aprioriCandidates) {
                if (scoreMap.has(pid)) {
                    scoreMap.get(pid).apriori = confidence; // Already [0,1]
                    scoreMap.get(pid).sources.push('apriori');
                } else {
                    scoreMap.set(pid, {
                        content: 0, cf: 0, apriori: confidence, personal: 0,
                        sources: ['apriori'], rawProduct: null
                    });
                }
            }
        }

        // ── Step 4: Personalization bonus ──
        const personalBonus = customerType === 'vip' ? 1.0
            : customerType === 'wholesale' ? 0.8
            : 0.3;

        for (const entry of scoreMap.values()) {
            entry.personal = personalBonus;
        }

        // ── Step 5: Compute final ensemble score ──
        const results = [];
        for (const [pid, entry] of scoreMap) {
            // Dynamic weight redistribution for cold-start
            let w = { ...this._weights };
            if (entry.cf === 0 && cfResults.length === 0) {
                // No CF data → redistribute β to α
                w.alpha += w.beta;
                w.beta = 0;
            }

            const finalScore = 
                w.alpha * entry.content +
                w.beta * entry.cf +
                w.gamma * entry.apriori +
                w.delta * entry.personal;

            results.push({
                product_id: pid,
                final_score: Math.round(finalScore * 10000) / 10000,
                scores: {
                    content: Math.round(entry.content * 10000) / 10000,
                    cf: Math.round(entry.cf * 10000) / 10000,
                    apriori: Math.round(entry.apriori * 10000) / 10000,
                    personal: Math.round(entry.personal * 10000) / 10000
                },
                sources: entry.sources,
                topSource: this._getTopSource(entry, w),
                rawProduct: entry.rawProduct
            });
        }

        results.sort((a, b) => b.final_score - a.final_score);
        return results;
    }

    /**
     * Determine which source contributed most to this product's score
     */
    _getTopSource(entry, weights) {
        const contributions = {
            content: weights.alpha * entry.content,
            cf: weights.beta * entry.cf,
            apriori: weights.gamma * entry.apriori,
            personal: weights.delta * entry.personal
        };
        return Object.entries(contributions)
            .sort((a, b) => b[1] - a[1])[0][0];
    }

    /**
     * Record recommendation feedback for weight learning
     */
    async recordFeedback(userId, productId, storeId, source, action, sessionId = null, score = null) {
        try {
            await this.pool.query(`
                INSERT INTO recommendation_feedback 
                    (user_id, product_id, store_id, source, action, session_id, recommendation_score)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [userId, productId, storeId, source, action, sessionId, score]);
        } catch (err) {
            logger.warn({ err }, 'Hybrid: Failed to record feedback');
        }
    }

    /**
     * Get current weights (for monitoring/debugging)
     */
    getWeights() {
        return { ...this._weights };
    }
}

module.exports = HybridRecommendationService;
