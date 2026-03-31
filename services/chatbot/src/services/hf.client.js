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
        this.model = model || 'microsoft/Phi-3-mini-4k-instruct';
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
}

module.exports = HFClient;
