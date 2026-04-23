/**
 * Context Helpers — Shared personalization & co-purchase logic
 * Extracted from rag.service.js for reuse across all intent handlers.
 */
const logger = require('../../../../shared/common/logger');

/**
 * Get customer personalization context from Auth service.
 * @param {object} apiClient - ApiClient instance
 * @param {number|null} customerId
 * @returns {{ type: string, prompt: string, totalSpent: number }}
 */
async function getPersonalizationContext(apiClient, customerId) {
    if (!customerId || !apiClient) return { type: 'retail', prompt: '' };

    try {
        const result = await apiClient.getCustomerProfile(customerId);
        if (!result?.success || !result.data) return { type: 'retail', prompt: '' };

        const customer = result.data;
        const type = customer.customerType || 'retail';

        const prompts = {
            vip: 'Khách VIP — ưu tiên sản phẩm premium, thông báo chương trình giảm giá đặc biệt.',
            wholesale: 'Khách sỉ — gợi ý số lượng lớn, giá sỉ, đơn vị thùng/lốc.',
            retail: 'Khách lẻ — gợi ý sản phẩm giá tốt, deal đang có, sản phẩm phổ thông.'
        };

        return {
            type,
            prompt: prompts[type] || prompts.retail,
            totalSpent: customer.totalSpent || 0
        };
    } catch (err) {
        logger.warn({ err, customerId }, 'Customer profile fetch failed — using default');
        return { type: 'retail', prompt: '' };
    }
}

/**
 * Get co-purchase suggestions for a list of product IDs.
 * @param {object} copurchaseRepo - CoPurchaseRepository instance
 * @param {number[]} productIds
 * @param {number} storeId
 * @param {number} limit - max related per product
 * @returns {string} Formatted co-purchase hint for prompt injection
 */
async function getCoPurchaseHint(copurchaseRepo, productIds, storeId, limit = 3) {
    if (!copurchaseRepo || !productIds?.length) return '';

    try {
        const allRelated = [];
        for (const productId of productIds.slice(0, 3)) {
            const related = await copurchaseRepo.getRelatedProducts(productId, storeId, limit);
            if (related.length > 0) {
                allRelated.push({ productId, related });
            }
        }

        if (allRelated.length === 0) return '';

        return 'Sản phẩm thường mua kèm: ' +
            allRelated.map(cp => {
                const items = cp.related.map(r => {
                    const conf = Number(r.confidence) > 0
                        ? ` (${Math.round(r.confidence * 100)}% mua kèm)`
                        : '';
                    return `Product #${r.product_id_b}${conf}`;
                });
                return `Product #${cp.productId} → ${items.join(', ')}`;
            }).join('; ');
    } catch (err) {
        logger.warn({ err }, 'Co-purchase lookup failed — skipping');
        return '';
    }
}

/**
 * Get co-purchase raw data (for RAG service structured usage).
 * @param {object} copurchaseRepo
 * @param {object[]} topProducts - array with product_id + content fields
 * @param {number} storeId
 * @returns {object[]}
 */
async function getCoPurchaseContext(copurchaseRepo, topProducts, storeId) {
    if (!copurchaseRepo) return [];

    try {
        const allRelated = [];
        for (const product of topProducts.slice(0, 3)) {
            const related = await copurchaseRepo.getRelatedProducts(
                product.product_id, storeId, 3
            );
            if (related.length > 0) {
                allRelated.push({
                    productId: product.product_id,
                    productName: product.content.match(/"([^"]+)"/)?.[1] || `Product ${product.product_id}`,
                    relatedProducts: related.map(r => ({
                        ...r,
                        confidence: Number(r.confidence) || 0,
                        lift: Number(r.lift) || 0
                    }))
                });
            }
        }
        return allRelated;
    } catch (err) {
        logger.warn({ err }, 'Co-purchase lookup failed — skipping');
        return [];
    }
}
/**
 * Get CF-based recommendation hint for prompt injection.
 * @param {object} cfService - CollaborativeFilteringService instance
 * @param {number|null} customerId
 * @param {number} storeId
 * @param {number} limit
 * @returns {string} Formatted CF hint for prompt injection
 */
async function getCFHint(cfService, customerId, storeId, limit = 3) {
    if (!cfService || !customerId) return '';

    try {
        const recs = await cfService.getRecommendations(customerId, storeId, limit);
        if (recs.length === 0) return '';

        return 'Gợi ý cá nhân hóa (dựa trên lịch sử mua hàng của bạn): ' +
            recs.map(r => `Product #${r.product_id} (điểm phù hợp: ${r.prediction_score})`).join(', ');
    } catch (err) {
        logger.warn({ err }, 'CF hint generation failed — skipping');
        return '';
    }
}

module.exports = { getPersonalizationContext, getCoPurchaseHint, getCoPurchaseContext, getCFHint };
