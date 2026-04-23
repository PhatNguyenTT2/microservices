/**
 * SessionContextService — Rule-based Session Intent Detection (Phase 3B1)
 * 
 * Phân tích chuỗi products trong phiên chat hiện tại để nhận diện
 * "ý định" của user (đang nấu lẩu? chuẩn bị bữa sáng? mua nhậu?).
 * 
 * Khi nhận diện được cluster → boost products cùng cluster trong ensemble.
 */
const logger = require('../../../../shared/common/logger');

// Cluster definitions (aligned with mock-interactions persona data)
const SESSION_CLUSTERS = {
    lau_bo: {
        name: 'Lẩu Bò / Nấu ăn',
        productIds: [1, 2, 3, 4, 5, 24, 25, 26, 27, 28],
        keywords: ['lẩu', 'bò', 'nấm', 'rau', 'nấu', 'gia vị', 'bún'],
        boost: 0.15
    },
    bua_sang: {
        name: 'Bữa Sáng / Ăn nhẹ',
        productIds: [7, 8, 9, 10, 11],
        keywords: ['sáng', 'bánh mì', 'sữa', 'trứng', 'sandwich', 'xúc xích'],
        boost: 0.12
    },
    an_vat: {
        name: 'Ăn vặt / Sinh viên',
        productIds: [12, 11, 19, 20, 7, 8],
        keywords: ['mì', 'snack', 'nước ngọt', 'ăn vặt', 'gói', 'coca'],
        boost: 0.12
    },
    nhau: {
        name: 'Nhậu / Giải khát',
        productIds: [17, 18, 19, 20, 21, 22],
        keywords: ['bia', 'nhậu', 'khô', 'đậu phộng', 'mồi', 'giải khát'],
        boost: 0.15
    },
    gia_vi: {
        name: 'Gia vị / Nêm nếm',
        productIds: [4, 13, 16, 23, 49, 52, 53],
        keywords: ['gia vị', 'nước mắm', 'muối', 'đường', 'bột ngọt', 'hạt nêm', 'dầu ăn'],
        boost: 0.10
    }
};

class SessionContextService {
    /**
     * Extract product IDs mentioned/recommended in chat history
     * @param {object[]} chatHistory - array of { role, content, productIds? }
     * @returns {number[]} ordered product IDs from session
     */
    extractProductSequence(chatHistory) {
        if (!chatHistory?.length) return [];

        const sequence = [];
        const seen = new Set();

        for (const msg of chatHistory) {
            // From structured productIds (if available)
            if (msg.productIds && Array.isArray(msg.productIds)) {
                for (const pid of msg.productIds) {
                    const id = Number(pid);
                    if (!seen.has(id)) {
                        sequence.push(id);
                        seen.add(id);
                    }
                }
            }

            // From text content (pattern: "Product #XX" or product names)
            if (msg.content) {
                const productRefs = msg.content.match(/Product\s*#(\d+)/gi);
                if (productRefs) {
                    for (const ref of productRefs) {
                        const id = Number(ref.match(/\d+/)[0]);
                        if (!seen.has(id)) {
                            sequence.push(id);
                            seen.add(id);
                        }
                    }
                }
            }
        }

        return sequence;
    }

    /**
     * Infer session intent from product sequence + message text
     * @param {number[]} productSequence - ordered product IDs
     * @param {string} lastMessage - latest user message
     * @returns {{ cluster: string, name: string, confidence: number, boost: number } | null}
     */
    inferSessionIntent(productSequence, lastMessage = '') {
        const scores = {};

        // Score by product matches
        for (const [clusterKey, cluster] of Object.entries(SESSION_CLUSTERS)) {
            let productHits = 0;
            for (const pid of productSequence) {
                if (cluster.productIds.includes(pid)) productHits++;
            }

            // Score by keyword matches in message
            let keywordHits = 0;
            if (lastMessage) {
                const msgLower = lastMessage.toLowerCase();
                for (const kw of cluster.keywords) {
                    if (msgLower.includes(kw)) keywordHits++;
                }
            }

            // Weighted: product match = 2, keyword match = 1
            const totalScore = productHits * 2 + keywordHits;
            if (totalScore > 0) {
                scores[clusterKey] = totalScore;
            }
        }

        if (Object.keys(scores).length === 0) return null;

        // Find top cluster
        const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
        const [topKey, topScore] = sorted[0];
        const secondScore = sorted.length > 1 ? sorted[1][1] : 0;

        // Confidence: how dominant is the top cluster?
        const totalAllScores = Object.values(scores).reduce((s, v) => s + v, 0);
        const confidence = totalAllScores > 0 ? topScore / totalAllScores : 0;

        // If top cluster is not clearly dominant, mark as "exploring"
        if (confidence < 0.4 || (secondScore > 0 && topScore / secondScore < 1.5)) {
            return {
                cluster: 'exploring',
                name: 'Đang khám phá',
                confidence: Math.round(confidence * 100) / 100,
                boost: 0
            };
        }

        const cluster = SESSION_CLUSTERS[topKey];
        return {
            cluster: topKey,
            name: cluster.name,
            confidence: Math.round(confidence * 100) / 100,
            boost: cluster.boost,
            productIds: cluster.productIds
        };
    }

    /**
     * Apply session context boost to ensemble results
     * @param {object[]} ensembleResults - from hybrid.service score()
     * @param {object|null} sessionIntent - from inferSessionIntent()
     * @returns {object[]} re-sorted results with session boost applied
     */
    applySessionBoost(ensembleResults, sessionIntent) {
        if (!sessionIntent || sessionIntent.cluster === 'exploring' || !sessionIntent.productIds) {
            return ensembleResults;
        }

        const boostedResults = ensembleResults.map(r => {
            const inCluster = sessionIntent.productIds.includes(r.product_id);
            const boostedScore = inCluster
                ? r.final_score + sessionIntent.boost
                : r.final_score;

            return {
                ...r,
                final_score: Math.round(boostedScore * 10000) / 10000,
                session_boosted: inCluster,
                session_cluster: inCluster ? sessionIntent.cluster : null
            };
        });

        boostedResults.sort((a, b) => b.final_score - a.final_score);

        logger.info({
            cluster: sessionIntent.cluster,
            confidence: sessionIntent.confidence,
            boostedCount: boostedResults.filter(r => r.session_boosted).length
        }, 'Session: Context boost applied');

        return boostedResults;
    }
}

module.exports = SessionContextService;
