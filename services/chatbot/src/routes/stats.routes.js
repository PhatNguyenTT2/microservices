const express = require('express');
const router = express.Router();
const logger = require('../../../../shared/common/logger');

/**
 * Stats/Monitoring routes — Phase 4 Observability
 *
 * Provides CTR (Click-Through Rate) and CVR (Conversion Rate) metrics
 * plus latency breakdown for bottleneck identification.
 *
 * @param {object} deps - { pool, hybridService, nightlyBatch }
 */
module.exports = function statsRoutes({ pool, hybridService, nightlyBatch, weightLearner }) {

    /**
     * GET /api/chatbot/stats/recommendations?storeId=1&days=30
     * Aggregated recommendation performance metrics
     */
    router.get('/stats/recommendations', async (req, res, next) => {
        try {
            const storeId = parseInt(req.query.storeId) || 1;
            const days = parseInt(req.query.days) || 30;

            // Action counts
            const { rows: actionStats } = await pool.query(`
                SELECT action, COUNT(*)::int AS count
                FROM recommendation_feedback
                WHERE store_id = $1 AND created_at > NOW() - INTERVAL '1 day' * $2
                GROUP BY action
            `, [storeId, days]);

            const actionMap = {};
            for (const r of actionStats) {
                actionMap[r.action] = r.count;
            }

            const totalRecommended = actionMap.recommended || 0;
            const totalClicked = actionMap.clicked || 0;
            const totalAddedToCart = actionMap.added_to_cart || 0;
            const totalPurchased = actionMap.purchased || 0;

            // Source breakdown
            const { rows: sourceStats } = await pool.query(`
                SELECT source,
                    COUNT(*) FILTER (WHERE action = 'recommended')::int AS recommended,
                    COUNT(*) FILTER (WHERE action = 'clicked')::int AS clicked,
                    COUNT(*) FILTER (WHERE action = 'purchased')::int AS purchased
                FROM recommendation_feedback
                WHERE store_id = $1 AND created_at > NOW() - INTERVAL '1 day' * $2
                GROUP BY source
            `, [storeId, days]);

            const sourceBreakdown = {};
            for (const r of sourceStats) {
                sourceBreakdown[r.source] = {
                    recommended: r.recommended,
                    clicked: r.clicked,
                    purchased: r.purchased,
                    ctr: r.recommended > 0 ? Math.round((r.clicked / r.recommended) * 10000) / 10000 : 0,
                    cvr: r.recommended > 0 ? Math.round((r.purchased / r.recommended) * 10000) / 10000 : 0
                };
            }

            // Current weights
            const weights = hybridService ? hybridService.getWeights() : null;

            // Nightly batch status
            const batchStatus = nightlyBatch ? nightlyBatch.getStatus() : null;

            res.json({
                success: true,
                data: {
                    period: { days, storeId },
                    funnel: {
                        totalRecommended,
                        totalClicked,
                        totalAddedToCart,
                        totalPurchased
                    },
                    rates: {
                        clickThroughRate: totalRecommended > 0
                            ? Math.round((totalClicked / totalRecommended) * 10000) / 10000 : 0,
                        addToCartRate: totalRecommended > 0
                            ? Math.round((totalAddedToCart / totalRecommended) * 10000) / 10000 : 0,
                        conversionRate: totalRecommended > 0
                            ? Math.round((totalPurchased / totalRecommended) * 10000) / 10000 : 0
                    },
                    sourceBreakdown,
                    currentWeights: weights,
                    lastBatchRun: batchStatus?.lastRunAt || null,
                    batchResult: batchStatus?.lastResult || null
                }
            });
        } catch (err) {
            next(err);
        }
    });

    /**
     * GET /api/chatbot/stats/latency?storeId=1
     * Pipeline latency metrics (from recent chat_message metadata)
     */
    router.get('/stats/latency', async (req, res, next) => {
        try {
            const storeId = parseInt(req.query.storeId) || 1;

            // Query recent metadata from chat messages (last 24h)
            const { rows } = await pool.query(`
                SELECT metadata
                FROM chat_message
                WHERE role = 'assistant'
                  AND metadata IS NOT NULL
                  AND metadata::text != 'null'
                  AND created_at > NOW() - INTERVAL '24 hours'
                ORDER BY created_at DESC
                LIMIT 100
            `);

            if (rows.length === 0) {
                return res.json({
                    success: true,
                    data: {
                        sampleSize: 0,
                        message: 'No recent chat messages with metadata found'
                    }
                });
            }

            const latencies = { total: [], hybrid: [], generation: [], embedding: [] };

            for (const row of rows) {
                const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
                if (!meta?.totalLatencyMs) continue;

                latencies.total.push(meta.totalLatencyMs);
                if (meta.steps?.hybrid?.latencyMs) latencies.hybrid.push(meta.steps.hybrid.latencyMs);
                if (meta.steps?.generation?.latencyMs) latencies.generation.push(meta.steps.generation.latencyMs);
                if (meta.steps?.embedding?.latencyMs) latencies.embedding.push(meta.steps.embedding.latencyMs);
            }

            const calc = (arr) => {
                if (arr.length === 0) return { avg: 0, p95: 0, min: 0, max: 0 };
                const sorted = [...arr].sort((a, b) => a - b);
                return {
                    avg: Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length),
                    p95: sorted[Math.floor(sorted.length * 0.95)] || sorted[sorted.length - 1],
                    min: sorted[0],
                    max: sorted[sorted.length - 1]
                };
            };

            res.json({
                success: true,
                data: {
                    sampleSize: latencies.total.length,
                    period: 'last 24 hours',
                    total: calc(latencies.total),
                    hybrid: calc(latencies.hybrid),
                    generation: calc(latencies.generation),
                    embedding: calc(latencies.embedding)
                }
            });
        } catch (err) {
            next(err);
        }
    });

    // ── Phase 5: Feedback Stream ──

    /**
     * GET /api/chatbot/stats/feedback-stream?storeId=1&limit=50
     * Recent recommendation interactions for live dashboard
     */
    router.get('/stats/feedback-stream', async (req, res, next) => {
        try {
            const storeId = parseInt(req.query.storeId) || 1;
            const limit = Math.min(parseInt(req.query.limit) || 50, 100);

            const { rows } = await pool.query(`
                SELECT rf.id, rf.user_id, rf.product_id, rf.source, rf.action,
                       rf.recommendation_score, rf.created_at,
                       pkb.content AS product_info
                FROM recommendation_feedback rf
                LEFT JOIN product_knowledge_base pkb
                    ON pkb.product_id = rf.product_id AND pkb.store_id = rf.store_id
                WHERE rf.store_id = $1
                ORDER BY rf.created_at DESC
                LIMIT $2
            `, [storeId, limit]);

            // Extract product name from content field
            const feedbacks = rows.map(r => {
                let productName = `Product #${r.product_id}`;
                if (r.product_info) {
                    const match = r.product_info.match(/Sản phẩm "([^"]+)"/);
                    if (match) productName = match[1];
                }
                return {
                    id: r.id,
                    userId: r.user_id,
                    productId: r.product_id,
                    productName,
                    source: r.source,
                    action: r.action,
                    score: r.recommendation_score ? Number(r.recommendation_score) : null,
                    createdAt: r.created_at
                };
            });

            res.json({ success: true, data: { feedbacks } });
        } catch (err) {
            next(err);
        }
    });

    /**
     * GET /api/chatbot/stats/weight-history?storeId=1&limit=30
     * Ensemble weight change log for trend visualization
     */
    router.get('/stats/weight-history', async (req, res, next) => {
        try {
            const storeId = parseInt(req.query.storeId) || 1;
            const limit = Math.min(parseInt(req.query.limit) || 30, 90);

            const { rows } = await pool.query(`
                SELECT alpha, beta, gamma, delta, feedback_count,
                       trigger_type, created_at
                FROM ensemble_weights_history
                WHERE store_id = $1
                ORDER BY created_at DESC
                LIMIT $2
            `, [storeId, limit]);

            // Reverse to chronological order for chart
            const history = rows.reverse().map(r => ({
                alpha: Number(r.alpha),
                beta: Number(r.beta),
                gamma: Number(r.gamma),
                delta: Number(r.delta),
                feedbackCount: r.feedback_count,
                triggerType: r.trigger_type,
                date: r.created_at
            }));

            res.json({ success: true, data: { history } });
        } catch (err) {
            next(err);
        }
    });

    /**
     * POST /api/chatbot/admin/force-learn
     * Trigger weight learning immediately (Admin only)
     */
    router.post('/admin/force-learn', async (req, res, next) => {
        try {
            if (!weightLearner) {
                return res.status(503).json({
                    success: false,
                    error: { message: 'WeightLearner not available' }
                });
            }

            const storeId = parseInt(req.body.storeId) || 1;
            const result = await weightLearner.learn(storeId, 'manual');

            // Refresh in-memory cache immediately
            if (!result.skipped && hybridService) {
                await hybridService.warmUp(storeId);
            }

            res.json({
                success: true,
                data: {
                    ...result,
                    message: result.skipped
                        ? `Skipped: only ${result.feedbackCount} feedbacks (need ${20})`
                        : 'Weights updated and cache refreshed'
                }
            });
        } catch (err) {
            next(err);
        }
    });

    return router;
};
