/**
 * CoPurchaseRepository — Co-purchase statistics
 * Tracks products frequently bought together (from order.completed events)
 * Used by RAGService for "frequently bought together" enrichment
 */
const logger = require('../../../../shared/common/logger');

class CoPurchaseRepository {
    constructor(pool) {
        this.pool = pool;
    }

    /**
     * UPSERT co-purchase pairs from an order's product list
     * Creates all (A, B) pairs where A < B (sorted to avoid duplicates)
     * @param {number[]} productIds - products in the same order
     * @param {number} storeId
     */
    async upsertPairs(productIds, storeId) {
        if (!productIds?.length || productIds.length < 2) return;

        const sortedIds = [...new Set(productIds)].sort((a, b) => a - b);

        for (let i = 0; i < sortedIds.length; i++) {
            for (let j = i + 1; j < sortedIds.length; j++) {
                await this.pool.query(`
                    INSERT INTO co_purchase_stats (product_id_a, product_id_b, store_id, co_purchase_count, last_updated_at)
                    VALUES ($1, $2, $3, 1, NOW())
                    ON CONFLICT (product_id_a, product_id_b, store_id)
                    DO UPDATE SET
                        co_purchase_count = co_purchase_stats.co_purchase_count + 1,
                        last_updated_at = NOW()
                `, [sortedIds[i], sortedIds[j], storeId]);
            }
        }

        logger.debug({ pairCount: sortedIds.length * (sortedIds.length - 1) / 2, storeId }, 'Co-purchase pairs upserted');
    }

    /**
     * Get products frequently bought with a given product
     * Ranked by Apriori lift (falls back to co_purchase_count if lift not computed)
     * @param {number} productId
     * @param {number} storeId
     * @param {number} minCount - minimum co-purchase count threshold
     * @returns {object[]} related products sorted by lift DESC
     */
    async getRelatedProducts(productId, storeId, minCount = 3) {
        const { rows } = await this.pool.query(`
            SELECT product_id_b, co_purchase_count,
                   COALESCE(confidence_ab, 0) AS confidence,
                   COALESCE(lift, 0) AS lift
            FROM co_purchase_stats
            WHERE product_id_a = $1 AND store_id = $2
              AND co_purchase_count >= $3
              AND (lift > 1 OR lift = 0)
            UNION ALL
            SELECT product_id_a, co_purchase_count,
                   COALESCE(confidence_ba, 0) AS confidence,
                   COALESCE(lift, 0) AS lift
            FROM co_purchase_stats
            WHERE product_id_b = $1 AND store_id = $2
              AND co_purchase_count >= $3
              AND (lift > 1 OR lift = 0)
            ORDER BY lift DESC, co_purchase_count DESC
            LIMIT 3
        `, [productId, storeId, minCount]);

        return rows;
    }

    /**
     * Get top co-purchase pairs for a store (monitoring/debug)
     */
    async getTopPairs(storeId, limit = 10) {
        const { rows } = await this.pool.query(`
            SELECT product_id_a, product_id_b, co_purchase_count,
                   ROUND(COALESCE(confidence_ab, 0)::numeric, 3) AS confidence_ab,
                   ROUND(COALESCE(lift, 0)::numeric, 2) AS lift,
                   last_updated_at
            FROM co_purchase_stats
            WHERE store_id = $1
            ORDER BY lift DESC, co_purchase_count DESC
            LIMIT $2
        `, [storeId, limit]);
        return rows;
    }

    /**
     * Get Apriori metrics for a specific pair (debug/monitoring)
     * @param {number} productIdA
     * @param {number} productIdB
     * @param {number} storeId
     * @returns {object|null}
     */
    async getAprioriMetrics(productIdA, productIdB, storeId) {
        const [a, b] = [productIdA, productIdB].sort((x, y) => x - y);
        const { rows } = await this.pool.query(`
            SELECT product_id_a, product_id_b, co_purchase_count,
                   ROUND(support::numeric, 4) AS support,
                   ROUND(confidence_ab::numeric, 3) AS confidence_ab,
                   ROUND(confidence_ba::numeric, 3) AS confidence_ba,
                   ROUND(lift::numeric, 2) AS lift,
                   total_orders
            FROM co_purchase_stats
            WHERE product_id_a = $1 AND product_id_b = $2 AND store_id = $3
        `, [a, b, storeId]);
        return rows[0] || null;
    }
}

module.exports = CoPurchaseRepository;
