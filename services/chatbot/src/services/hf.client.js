const { InferenceClient } = require('@huggingface/inference');
const logger = require('../../../../shared/common/logger');

const SYSTEM_PROMPT = `Bạn là POSMART Assistant — trợ lý AI cho hệ thống quản lý chuỗi cửa hàng tiện lợi POSMART.

Vai trò của bạn:
- Hỗ trợ nhân viên kiểm tra tồn kho, giá sản phẩm, trạng thái đơn hàng
- Hỗ trợ khách hàng tìm sản phẩm, kiểm tra đơn hàng, hỏi đáp chung
- Trả lời ngắn gọn, chính xác, thân thiện
- Luôn trả lời bằng tiếng Việt trừ khi khách hỏi bằng tiếng Anh

Khi nhận được dữ liệu từ hệ thống (đánh dấu [DATA]), hãy format lại thành câu trả lời tự nhiên.
Nếu không có dữ liệu, trả lời dựa trên kiến thức chung.`;

class HFClient {
    constructor(accessToken, model) {
        this.client = new InferenceClient(accessToken);
        this.model = model || 'Qwen/Qwen2.5-7B-Instruct';
        logger.info({ model: this.model }, 'HF Inference Client initialized');
    }

    async chatCompletion(messages, options = {}) {
        const startTime = Date.now();

        try {
            const response = await this.client.chatCompletion({
                model: this.model,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    ...messages
                ],
                max_tokens: options.maxTokens || 512,
                temperature: options.temperature || 0.7,
            });

            const latencyMs = Date.now() - startTime;
            const reply = response.choices[0].message.content;

            logger.info({ model: this.model, latencyMs, tokenCount: reply.length }, 'HF chat completion done');

            return {
                content: reply,
                model: this.model,
                latencyMs,
                usage: response.usage || null
            };
        } catch (err) {
            const latencyMs = Date.now() - startTime;
            logger.error({ err, model: this.model, latencyMs }, 'HF Inference API error');

            if (err.message?.includes('rate limit')) {
                return {
                    content: 'Xin lỗi, hệ thống AI đang bận. Vui lòng thử lại sau giây lát.',
                    model: this.model,
                    latencyMs,
                    error: 'RATE_LIMITED'
                };
            }

            return {
                content: 'Xin lỗi, hiện tại tôi không thể xử lý yêu cầu này. Vui lòng thử lại sau.',
                model: this.model,
                latencyMs,
                error: err.message
            };
        }
    }

    /**
     * Streaming chat completion — yields tokens one-by-one
     * @param {Array} messages - chat messages
     * @param {object} options - { maxTokens, temperature }
     * @yields {string} individual tokens
     * @returns {{ content: string, model: string, latencyMs: number }}
     */
    async *chatCompletionStream(messages, options = {}) {
        const startTime = Date.now();

        try {
            const stream = this.client.chatCompletionStream({
                model: this.model,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    ...messages
                ],
                max_tokens: options.maxTokens || 512,
                temperature: options.temperature || 0.7,
            });

            let fullContent = '';
            for await (const chunk of stream) {
                const token = chunk.choices?.[0]?.delta?.content;
                if (token) {
                    fullContent += token;
                    yield token;
                }
            }

            const latencyMs = Date.now() - startTime;
            logger.info({ model: this.model, latencyMs, contentLength: fullContent.length }, 'HF stream completion done');

            return {
                content: fullContent,
                model: this.model,
                latencyMs
            };
        } catch (err) {
            const latencyMs = Date.now() - startTime;
            logger.error({ err, model: this.model, latencyMs }, 'HF stream error');

            yield 'Xin lỗi, hiện tại tôi không thể xử lý yêu cầu này. Vui lòng thử lại sau.';
        }
    }
}

module.exports = HFClient;
