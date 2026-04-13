/**
 * QueryReformulator — Rewrite ambiguous follow-up questions
 * Detects pronouns ("nó", "cái đó", "loại này") and uses Qwen/Qwen2.5-7B-Instruct
 * to rewrite them into standalone queries using chat history
 */
const logger = require('../../../../shared/common/logger');

const VIETNAMESE_PRONOUNS = [
    'nó', 'cái đó', 'cái này', 'cái kia', 'loại này', 'loại đó',
    'món đó', 'món này', 'thế', 'vậy', 'sản phẩm đó', 'hàng đó'
];

class QueryReformulator {
    constructor(hfClient) {
        this.hfClient = hfClient;
    }

    /**
     * Reformulate a user message if it contains ambiguous pronouns
     * @param {string} userMessage - current user message
     * @param {object[]} chatHistory - recent messages [{role, content}]
     * @returns {string} standalone query (original or rewritten)
     */
    async reformulate(userMessage, chatHistory) {
        if (!this._needsReformulation(userMessage)) return userMessage;
        if (!chatHistory?.length) return userMessage;

        try {
            const startTime = Date.now();

            // Build minimal history for context (last 4 messages)
            const recentHistory = chatHistory.slice(-4);
            const historyText = recentHistory
                .map(m => `${m.role === 'user' ? 'Khách' : 'Bot'}: ${m.content}`)
                .join('\n');

            const prompt = `Dựa trên lịch sử hội thoại, viết lại câu hỏi sau thành câu hoàn chỉnh, độc lập, không cần ngữ cảnh.

Lịch sử:
${historyText}

Câu hỏi hiện tại: "${userMessage}"

Viết lại ngắn gọn (chỉ trả về câu viết lại, không giải thích):`;

            const result = await this.hfClient.chatCompletion(
                [{ role: 'user', content: prompt }],
                { maxTokens: 100, temperature: 0.3 }
            );

            const reformulated = result.content?.trim();
            const latencyMs = Date.now() - startTime;

            if (reformulated && reformulated.length > 3 && reformulated.length < 200) {
                logger.info({ original: userMessage, reformulated, latencyMs }, 'Query reformulated');
                return reformulated;
            }

            return userMessage;
        } catch (err) {
            logger.warn({ err, message: userMessage }, 'Query reformulation failed — using original');
            return userMessage;
        }
    }

    /**
     * Check if message contains ambiguous pronouns that need reformulation
     */
    _needsReformulation(msg) {
        const lower = msg.toLowerCase();
        return VIETNAMESE_PRONOUNS.some(p => lower.includes(p));
    }
}

module.exports = QueryReformulator;
