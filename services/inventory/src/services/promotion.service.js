const logger = require('../../../../shared/common/logger');
const axios = require('axios');

/**
 * Promotion Service
 * Applies auto-promotions to perishable product batches based on expiry dates.
 * 
 * Data flow:
 *   1. Fetch perishable product_ids from Catalog (HTTP)
 *   2. Query product_batch WHERE product_id IN (...) AND expiry filtering
 *   3. UPDATE discount_percentage + promotion_applied = 'auto_fresh'
 *   4. Cleanup: expired batches → promotion_applied = 'none', status = 'expired'
 */
class PromotionService {
    constructor({ pool, catalogBaseUrl }) {
        this.pool = pool;
        this.catalogBaseUrl = catalogBaseUrl || 'http://localhost:3002';
    }

    /**
     * Fetch perishable product IDs from Catalog Service
     */
    async _fetchPerishableProductIds(authToken) {
        try {
            const url = `${this.catalogBaseUrl}/api/categories/perishable-products`;
            const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};
            const response = await axios.get(url, { headers, timeout: 10000 });

            if (response.data?.success && Array.isArray(response.data.data)) {
                return response.data.data;
            }
            logger.warn('Unexpected response from Catalog perishable-products endpoint');
            return [];
        } catch (err) {
            logger.error({ err }, 'Failed to fetch perishable product IDs from Catalog');
            return [];
        }
    }

    /**
     * Calculate expiry date ranges based on promotion config
     */
    _calculateExpiryRanges(applyToExpiringToday, applyToExpiringTomorrow) {
        const now = new Date();
        const ranges = [];

        if (applyToExpiringToday) {
            const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);
            ranges.push({ label: 'Expiring within 24h', start: now, end: in24Hours });
        }

        if (applyToExpiringTomorrow) {
            const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);
            const in48Hours = new Date(now.getTime() + 48 * 60 * 60 * 1000);
            ranges.push({ label: 'Expiring within 48h', start: in24Hours, end: in48Hours });
        }

        return ranges;
    }

    /**
     * Apply auto-promotions to eligible perishable product batches
     * @param {Object} config - Promotion config from Settings service
     * @param {string} [authToken] - JWT token for cross-service auth
     */
    async applyAutoPromotions(config, authToken) {
        const {
            auto_promotion_enabled,
            promotion_discount_percentage,
            apply_to_expiring_today,
            apply_to_expiring_tomorrow
        } = config;

        if (!auto_promotion_enabled) {
            logger.info('Auto-promotion is DISABLED');
            return { success: false, message: 'Auto-promotion is disabled', applied: 0, removed: 0 };
        }

        const discountPct = parseFloat(promotion_discount_percentage) || 0;
        if (discountPct <= 0) {
            return { success: false, message: 'Invalid discount percentage', applied: 0, removed: 0 };
        }

        logger.info({ discountPct, apply_to_expiring_today, apply_to_expiring_tomorrow }, 'Running auto-promotion');

        // 1. Get perishable product IDs from Catalog
        const productIds = await this._fetchPerishableProductIds(authToken);
        if (productIds.length === 0) {
            logger.info('No perishable products found');
            return { success: true, message: 'No perishable products found', applied: 0, removed: 0 };
        }

        logger.info({ count: productIds.length }, 'Perishable products found');

        // 2. Calculate expiry ranges
        const ranges = this._calculateExpiryRanges(apply_to_expiring_today, apply_to_expiring_tomorrow);
        if (ranges.length === 0) {
            return { success: true, message: 'No expiry range configured', applied: 0, removed: 0 };
        }

        // 3. Apply promotions to eligible batches
        let totalApplied = 0;
        const appliedBatches = [];

        for (const range of ranges) {
            const result = await this.pool.query(`
                UPDATE product_batch
                SET discount_percentage = $1,
                    promotion_applied = 'auto_fresh'
                WHERE product_id = ANY($2)
                  AND status = 'active'
                  AND quantity > 0
                  AND expiry_date >= $3
                  AND expiry_date <= $4
                  AND (promotion_applied = 'none' OR (promotion_applied = 'auto_fresh' AND discount_percentage < $1))
                RETURNING id, product_id, discount_percentage, expiry_date
            `, [discountPct, productIds, range.start, range.end]);

            totalApplied += result.rowCount;
            appliedBatches.push(...result.rows.map(r => ({
                batchId: r.id,
                productId: r.product_id,
                discountPercentage: r.discount_percentage,
                expiryDate: r.expiry_date,
                range: range.label
            })));

            logger.info({ range: range.label, applied: result.rowCount }, 'Promotion applied for range');
        }

        // 4. Cleanup: remove auto_fresh promotions from expired batches
        const cleanupResult = await this.pool.query(`
            UPDATE product_batch
            SET promotion_applied = 'none',
                discount_percentage = 0,
                status = 'expired'
            WHERE product_id = ANY($1)
              AND expiry_date < NOW()
              AND promotion_applied = 'auto_fresh'
            RETURNING id, product_id
        `, [productIds]);

        const totalRemoved = cleanupResult.rowCount;

        logger.info({ applied: totalApplied, removed: totalRemoved }, 'Auto-promotion completed');

        return {
            success: true,
            message: 'Auto-promotion completed',
            applied: totalApplied,
            removed: totalRemoved,
            appliedBatches,
            removedBatches: cleanupResult.rows,
            timestamp: new Date()
        };
    }

    /**
     * Get promotion statistics
     */
    async getStats(authToken) {
        const productIds = await this._fetchPerishableProductIds(authToken);

        if (productIds.length === 0) {
            return {
                totalPerishableProducts: 0,
                activeBatchesWithPromotion: 0,
                batchesExpiringSoon: 0,
                expiredBatches: 0,
                timestamp: new Date()
            };
        }

        const [promoResult, expiringSoonResult, expiredResult] = await Promise.all([
            this.pool.query(`
                SELECT COUNT(*)::int as count FROM product_batch
                WHERE product_id = ANY($1) AND status = 'active' AND promotion_applied != 'none'
            `, [productIds]),
            this.pool.query(`
                SELECT COUNT(*)::int as count FROM product_batch
                WHERE product_id = ANY($1) AND status = 'active'
                  AND expiry_date >= NOW() AND expiry_date <= NOW() + INTERVAL '48 hours'
            `, [productIds]),
            this.pool.query(`
                SELECT COUNT(*)::int as count FROM product_batch
                WHERE product_id = ANY($1) AND expiry_date < NOW()
            `, [productIds])
        ]);

        return {
            totalPerishableProducts: productIds.length,
            activeBatchesWithPromotion: promoResult.rows[0].count,
            batchesExpiringSoon: expiringSoonResult.rows[0].count,
            expiredBatches: expiredResult.rows[0].count,
            timestamp: new Date()
        };
    }
}

module.exports = PromotionService;
