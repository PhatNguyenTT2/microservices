const express = require('express');
const router = express.Router();
const logger = require('../../../../shared/common/logger');

/**
 * Feedback routes — Phase 3 Feedback Loop
 * Records user interactions with recommended products.
 *
 * @param {object} hybridService - HybridRecommendationService instance
 */
module.exports = function feedbackRoutes(hybridService) {
    router.post('/feedback', async (req, res, next) => {
        try {
            const { userId, productId, storeId, source, action, sessionId, score } = req.body;

            if (!productId || !storeId || !source || !action) {
                return res.status(400).json({
                    success: false,
                    error: { message: 'Missing required fields: productId, storeId, source, action' }
                });
            }

            const validSources = ['content', 'cf', 'apriori', 'session'];
            const validActions = ['recommended', 'clicked', 'added_to_cart', 'purchased'];

            if (!validSources.includes(source)) {
                return res.status(400).json({
                    success: false,
                    error: { message: `Invalid source. Must be one of: ${validSources.join(', ')}` }
                });
            }
            if (!validActions.includes(action)) {
                return res.status(400).json({
                    success: false,
                    error: { message: `Invalid action. Must be one of: ${validActions.join(', ')}` }
                });
            }

            await hybridService.recordFeedback(
                userId || null, productId, storeId, source, action,
                sessionId || null, score || null
            );

            logger.info({ userId, productId, source, action }, 'Feedback recorded');
            res.status(201).json({ success: true });
        } catch (err) {
            next(err);
        }
    });

    return router;
};
