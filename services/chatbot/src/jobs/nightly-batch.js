/**
 * Nightly Batch Pipeline — Phase 4 Cron Orchestrator
 *
 * Schedule: 2:00 AM daily
 * Pipeline: Apriori → CF → Weight Learner → Cache Warmup
 *
 * Design (from feedback):
 *   - Isolated try/catch per step → one failure doesn't cascade
 *   - Fallback to old data if any step fails
 *   - Note: In multi-pod deployments, use Redis Lock (bullmq/redlock)
 *     to prevent duplicate execution. Current: single-instance node-cron.
 */
const cron = require('node-cron');
const logger = require('../../../../shared/common/logger');

class NightlyBatchPipeline {
    constructor({ pool, hybridService, cfService, weightLearner, copurchaseRepo }) {
        this.pool = pool;
        this.hybridService = hybridService;
        this.cfService = cfService;
        this.weightLearner = weightLearner;
        this.copurchaseRepo = copurchaseRepo;
        this.lastRunAt = null;
        this.lastResult = null;
    }

    /**
     * Start the nightly cron schedule.
     * @param {string} schedule - Cron expression (default: '0 2 * * *' = 2:00 AM)
     */
    start(schedule = '0 2 * * *') {
        cron.schedule(schedule, async () => {
            await this.run();
        });
        logger.info({ schedule }, 'Nightly batch pipeline scheduled');
    }

    /**
     * Run the full pipeline (can also be triggered manually).
     * @param {number} storeId - Target store (default: 1)
     */
    async run(storeId = 1) {
        const pipelineStart = Date.now();
        const results = {
            apriori: { status: 'skipped' },
            cf: { status: 'skipped' },
            weightLearner: { status: 'skipped' },
            cacheWarmup: { status: 'skipped' }
        };

        logger.info({ storeId }, '═══ Nightly Batch Pipeline START ═══');

        // ── Step 1: Apriori Batch ──
        try {
            const stepStart = Date.now();
            const aprioriResult = await this._runApriori(storeId);
            results.apriori = {
                status: 'success',
                ...aprioriResult,
                latencyMs: Date.now() - stepStart
            };
            logger.info(results.apriori, 'Step 1/4: Apriori DONE');
        } catch (err) {
            results.apriori = { status: 'failed', error: err.message };
            logger.error({ err, storeId }, 'Step 1/4: Apriori FAILED — using stale data');
        }

        // ── Step 2: CF Similarity Compute ──
        try {
            const stepStart = Date.now();
            const cfResult = await this.cfService.computeItemSimilarities(storeId);
            results.cf = {
                status: 'success',
                pairsComputed: cfResult?.pairsInserted || 0,
                latencyMs: Date.now() - stepStart
            };
            logger.info(results.cf, 'Step 2/4: CF Similarity DONE');
        } catch (err) {
            results.cf = { status: 'failed', error: err.message };
            logger.error({ err, storeId }, 'Step 2/4: CF Similarity FAILED — using stale data');
        }

        // ── Step 3: Weight Learner ──
        try {
            const stepStart = Date.now();
            const wlResult = await this.weightLearner.learn(storeId);
            results.weightLearner = {
                status: 'success',
                skipped: wlResult.skipped,
                feedbackCount: wlResult.feedbackCount,
                oldWeights: wlResult.oldWeights,
                newWeights: wlResult.newWeights,
                latencyMs: Date.now() - stepStart
            };
            logger.info(results.weightLearner, 'Step 3/4: Weight Learner DONE');
        } catch (err) {
            results.weightLearner = { status: 'failed', error: err.message };
            logger.error({ err, storeId }, 'Step 3/4: Weight Learner FAILED — keeping current weights');
        }

        // ── Step 4: Cache Warmup ──
        try {
            const stepStart = Date.now();
            await this.hybridService.warmUp(storeId);
            results.cacheWarmup = {
                status: 'success',
                cacheReady: true,
                latencyMs: Date.now() - stepStart
            };
            logger.info(results.cacheWarmup, 'Step 4/4: Cache Warmup DONE');
        } catch (err) {
            results.cacheWarmup = { status: 'failed', error: err.message };
            logger.error({ err, storeId }, 'Step 4/4: Cache Warmup FAILED — will use DB fallback');
        }

        // ── Summary ──
        const totalMs = Date.now() - pipelineStart;
        const failCount = Object.values(results).filter(r => r.status === 'failed').length;

        this.lastRunAt = new Date().toISOString();
        this.lastResult = { ...results, totalMs, failCount };

        if (failCount === 0) {
            logger.info({ totalMs, storeId }, '═══ Nightly Batch Pipeline COMPLETE (all steps OK) ═══');
        } else {
            logger.warn({ totalMs, failCount, storeId }, `═══ Nightly Batch Pipeline COMPLETE (${failCount} step(s) failed) ═══`);
        }

        return this.lastResult;
    }

    /**
     * Apriori in-memory computation (extracted from apriori-batch.js).
     * Computes support/confidence/lift for all co_purchase_stats pairs.
     */
    async _runApriori(storeId) {
        // Total orders
        const { rows: [{ total }] } = await this.pool.query(`
            SELECT COUNT(*)::int AS total
            FROM sale_order
            WHERE status = 'delivered' AND payment_status = 'paid'
        `);

        if (total === 0) return { pairsUpdated: 0, totalOrders: 0 };

        // Product frequency
        const { rows: freqRows } = await this.pool.query(`
            SELECT d.product_id, o.store_id, COUNT(DISTINCT o.id)::int AS order_count
            FROM sale_order_detail d
            JOIN sale_order o ON o.id = d.order_id
            WHERE o.status = 'delivered' AND o.payment_status = 'paid'
              AND d.product_id IS NOT NULL
            GROUP BY d.product_id, o.store_id
        `);

        const freqMap = new Map();
        for (const r of freqRows) {
            freqMap.set(`${r.product_id}-${r.store_id}`, r.order_count);
        }

        // Upsert product_order_frequency
        const CHUNK = 500;
        for (let c = 0; c < freqRows.length; c += CHUNK) {
            const chunk = freqRows.slice(c, c + CHUNK);
            const cv = [], cp = [];
            let ci = 1;
            for (const r of chunk) {
                cv.push(`($${ci}, $${ci + 1}, $${ci + 2}, NOW())`);
                cp.push(r.product_id, r.store_id, r.order_count);
                ci += 3;
            }
            await this.pool.query(`
                INSERT INTO product_order_frequency (product_id, store_id, order_count, last_computed_at)
                VALUES ${cv.join(', ')}
                ON CONFLICT (product_id, store_id)
                DO UPDATE SET order_count = EXCLUDED.order_count, last_computed_at = NOW()
            `, cp);
        }

        // Read pairs + compute metrics
        const { rows: pairs } = await this.pool.query(
            'SELECT id, product_id_a, product_id_b, store_id, co_purchase_count FROM co_purchase_stats'
        );

        const updates = [];
        for (const pair of pairs) {
            const countAB = pair.co_purchase_count;
            const countA = freqMap.get(`${pair.product_id_a}-${pair.store_id}`) || 0;
            const countB = freqMap.get(`${pair.product_id_b}-${pair.store_id}`) || 0;

            const support = total > 0 ? countAB / total : 0;
            const confidenceAB = countA > 0 ? countAB / countA : 0;
            const confidenceBA = countB > 0 ? countAB / countB : 0;
            const lift = (countA > 0 && countB > 0) ? (countAB * total) / (countA * countB) : 0;

            updates.push({
                id: pair.id,
                support: Math.round(support * 10000) / 10000,
                confidenceAB: Math.round(confidenceAB * 10000) / 10000,
                confidenceBA: Math.round(confidenceBA * 10000) / 10000,
                lift: Math.round(lift * 100) / 100,
                totalOrders: total
            });
        }

        // Batch update
        const UPDATE_CHUNK = 200;
        for (let c = 0; c < updates.length; c += UPDATE_CHUNK) {
            const chunk = updates.slice(c, c + UPDATE_CHUNK);
            const valueRows = [], params = [];
            let pi = 1;
            for (const u of chunk) {
                valueRows.push(`($${pi}::bigint, $${pi+1}::numeric, $${pi+2}::numeric, $${pi+3}::numeric, $${pi+4}::numeric, $${pi+5}::int)`);
                params.push(u.id, u.support, u.confidenceAB, u.confidenceBA, u.lift, u.totalOrders);
                pi += 6;
            }
            await this.pool.query(`
                UPDATE co_purchase_stats AS cs
                SET support = v.support, confidence_ab = v.confidence_ab,
                    confidence_ba = v.confidence_ba, lift = v.lift,
                    total_orders = v.total_orders, last_updated_at = NOW()
                FROM (VALUES ${valueRows.join(', ')})
                  AS v(id, support, confidence_ab, confidence_ba, lift, total_orders)
                WHERE cs.id = v.id
            `, params);
        }

        return { pairsUpdated: updates.length, totalOrders: total, productFrequencies: freqRows.length };
    }

    /** Get last run status (for monitoring API) */
    getStatus() {
        return { lastRunAt: this.lastRunAt, lastResult: this.lastResult };
    }
}

module.exports = NightlyBatchPipeline;
