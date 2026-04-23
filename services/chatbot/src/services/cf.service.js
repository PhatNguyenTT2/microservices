/**
 * CollaborativeFilteringService — Item-based CF (Phase 2)
 * 
 * Cosine Similarity between items based on user purchase behavior.
 * Uses plain Cosine (not Adjusted) — optimal for implicit feedback
 * where interaction_score = purchase_count × recency_weight.
 * 
 * Công thức:
 *   sim(i,j) = Σ_u R[u,i] × R[u,j] / (||R[*,i]|| × ||R[*,j]||)
 * 
 * Tại sao không dùng Adjusted Cosine?
 *   Adjusted Cosine trừ mean → khi users cùng cluster mua TẤT CẢ items
 *   primary đều đều → R[u,i] - mean ≈ 0 → similarity ≈ 0 (sai).
 *   Plain Cosine giữ nguyên magnitude → items cùng cluster → sim cao.
 */
const logger = require('../../../../shared/common/logger');

class CollaborativeFilteringService {
    constructor(pool) {
        this.pool = pool;
    }

    /**
     * Compute item similarities using Adjusted Cosine.
     * Strategy: Full in-memory (tránh N+1 — bài học Phase 1A)
     * 
     * @param {number} storeId
     * @param {number} minCommonUsers - Minimum common users for pair (noise filter)
     */
    async computeItemSimilarities(storeId, minCommonUsers = 2) {
        logger.info({ storeId }, 'CF: Computing item similarities...');
        const startTime = Date.now();

        // Step 1: Load all interactions into memory
        const { rows: interactions } = await this.pool.query(`
            SELECT user_id, product_id, interaction_score
            FROM user_product_interaction
            WHERE store_id = $1 AND interaction_score > 0
        `, [storeId]);

        if (interactions.length === 0) {
            logger.warn({ storeId }, 'CF: No interactions found. Skipping.');
            return { pairsComputed: 0 };
        }

        // Step 2: Build in-memory matrix R[user][item] + compute R̄u
        const userItems = new Map();   // userId → Map<productId, score>
        const itemUsers = new Map();   // productId → Set<userId>

        for (const row of interactions) {
            const uid = Number(row.user_id);
            const pid = Number(row.product_id);
            const score = Number(row.interaction_score);

            if (!userItems.has(uid)) userItems.set(uid, new Map());
            userItems.get(uid).set(pid, score);

            if (!itemUsers.has(pid)) itemUsers.set(pid, new Set());
            itemUsers.get(pid).add(uid);
        }

        // Step 3: Pre-compute item norms ||R[*,i]||
        const itemNorms = new Map();
        for (const [pid, users] of itemUsers) {
            let sumSq = 0;
            for (const uid of users) {
                const score = userItems.get(uid).get(pid);
                sumSq += score * score;
            }
            itemNorms.set(pid, Math.sqrt(sumSq));
        }

        // Step 4: Compute Cosine Similarity for each item pair
        const items = [...itemUsers.keys()].sort((a, b) => a - b);
        const similarities = [];

        for (let i = 0; i < items.length; i++) {
            for (let j = i + 1; j < items.length; j++) {
                const itemA = items[i];
                const itemB = items[j];

                // Common users who purchased both
                const usersA = itemUsers.get(itemA);
                const usersB = itemUsers.get(itemB);
                const commonUsers = [...usersA].filter(u => usersB.has(u));

                if (commonUsers.length < minCommonUsers) continue;

                // Cosine Similarity (plain, no mean subtraction)
                let dotProduct = 0;
                for (const uid of commonUsers) {
                    const ra = userItems.get(uid).get(itemA);
                    const rb = userItems.get(uid).get(itemB);
                    dotProduct += ra * rb;
                }

                // ⚠ Division by zero guard
                const normA = itemNorms.get(itemA);
                const normB = itemNorms.get(itemB);
                const denom = normA * normB;
                const sim = denom > 0 ? dotProduct / denom : 0;

                // Only keep meaningful similarities
                if (Math.abs(sim) >= 0.05) {
                    similarities.push({
                        itemA, itemB,
                        similarity: Math.round(sim * 10000) / 10000,
                        commonUsers: commonUsers.length
                    });
                }
            }
        }

        // Step 4: Batch INSERT into item_similarity
        await this.pool.query(`DELETE FROM item_similarity WHERE store_id = $1`, [storeId]);

        const CHUNK_SIZE = 300;
        for (let c = 0; c < similarities.length; c += CHUNK_SIZE) {
            const chunk = similarities.slice(c, c + CHUNK_SIZE);
            const values = [];
            const params = [];
            let pi = 1;

            for (const s of chunk) {
                values.push(`($${pi}, $${pi+1}, $${pi+2}, $${pi+3}, $${pi+4}, NOW())`);
                params.push(s.itemA, s.itemB, storeId, s.similarity, s.commonUsers);
                pi += 5;
            }

            await this.pool.query(`
                INSERT INTO item_similarity (item_a, item_b, store_id, similarity, common_users, computed_at)
                VALUES ${values.join(', ')}
                ON CONFLICT (item_a, item_b, store_id)
                DO UPDATE SET similarity = EXCLUDED.similarity,
                              common_users = EXCLUDED.common_users,
                              computed_at = NOW()
            `, params);
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        logger.info({
            storeId,
            totalItems: items.length,
            totalPairs: similarities.length,
            positiveSim: similarities.filter(s => s.similarity > 0.3).length,
            elapsed: `${elapsed}s`
        }, 'CF: Item similarities computed');

        return {
            totalItems: items.length,
            pairsComputed: similarities.length,
            elapsed
        };
    }

    /**
     * Get CF recommendations for a user
     * @param {number} userId
     * @param {number} storeId
     * @param {number} limit
     * @returns {object[]} recommended products sorted by prediction score
     */
    async getRecommendations(userId, storeId, limit = 5) {
        // Step 1: Items user already purchased
        const { rows: purchased } = await this.pool.query(`
            SELECT product_id, interaction_score
            FROM user_product_interaction
            WHERE user_id = $1 AND store_id = $2 AND interaction_score > 0
        `, [userId, storeId]);

        // Cold start → empty
        if (purchased.length === 0) return [];

        const purchasedIds = new Set(purchased.map(r => Number(r.product_id)));
        const purchasedScores = new Map(
            purchased.map(r => [Number(r.product_id), Number(r.interaction_score)])
        );

        // Step 2: Find similar items NOT yet purchased
        const { rows: candidates } = await this.pool.query(`
            SELECT item_b AS candidate_id, item_a AS source_id, similarity
            FROM item_similarity
            WHERE item_a = ANY($1::bigint[]) AND store_id = $2 AND similarity >= 0.1
            UNION ALL
            SELECT item_a AS candidate_id, item_b AS source_id, similarity
            FROM item_similarity
            WHERE item_b = ANY($1::bigint[]) AND store_id = $2 AND similarity >= 0.1
        `, [[...purchasedIds], storeId]);

        // Step 3: Compute prediction score
        // pred(u, i) = Σ sim(i,j) × R[u,j] / Σ |sim(i,j)|
        const predictions = new Map(); // candidateId → { numSum, denomSum }

        for (const row of candidates) {
            const cid = Number(row.candidate_id);
            if (purchasedIds.has(cid)) continue; // Already purchased

            const sim = Number(row.similarity);
            const sourceScore = purchasedScores.get(Number(row.source_id)) || 0;

            if (!predictions.has(cid)) {
                predictions.set(cid, { numSum: 0, denomSum: 0 });
            }
            const pred = predictions.get(cid);
            pred.numSum += sim * sourceScore;
            pred.denomSum += Math.abs(sim);
        }

        // Step 4: Sort by prediction score
        const results = [];
        for (const [productId, pred] of predictions) {
            const score = pred.denomSum > 0 ? pred.numSum / pred.denomSum : 0;
            if (score > 0) {
                results.push({
                    product_id: productId,
                    prediction_score: Math.round(score * 1000) / 1000,
                    contributing_items: pred.denomSum
                });
            }
        }

        results.sort((a, b) => b.prediction_score - a.prediction_score);
        return results.slice(0, limit);
    }

    /**
     * Get item similarities for a product (debug/monitoring)
     */
    async getItemSimilarities(productId, storeId, limit = 5) {
        const { rows } = await this.pool.query(`
            SELECT item_b AS similar_item, similarity, common_users
            FROM item_similarity
            WHERE item_a = $1 AND store_id = $2 AND similarity >= 0.1
            UNION ALL
            SELECT item_a, similarity, common_users
            FROM item_similarity
            WHERE item_b = $1 AND store_id = $2 AND similarity >= 0.1
            ORDER BY similarity DESC
            LIMIT $3
        `, [productId, storeId, limit]);
        return rows;
    }
}

module.exports = CollaborativeFilteringService;
