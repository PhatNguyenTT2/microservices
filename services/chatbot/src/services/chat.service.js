const { ValidationError, NotFoundError } = require('../../../../shared/common/errors');
const { resolveIntent } = require('./intent.resolver');
const logger = require('../../../../shared/common/logger');

class ChatService {
    constructor(chatRepo, hfClient, apiClient = null) {
        this.chatRepo = chatRepo;
        this.hfClient = hfClient;
        this.apiClient = apiClient;
    }

    async startSession(userId, userType, storeId = null) {
        if (!userId) throw new ValidationError('user_id is required');
        if (!['customer', 'employee'].includes(userType)) {
            throw new ValidationError('user_type must be customer or employee');
        }
        return await this.chatRepo.createSession(userId, userType, storeId);
    }

    async getSession(sessionId) {
        const session = await this.chatRepo.findSessionById(sessionId);
        if (!session) throw new NotFoundError('Chat session');
        return session;
    }

    async getUserSessions(userId) {
        return await this.chatRepo.findSessionsByUser(userId);
    }

    async getSessionMessages(sessionId) {
        const session = await this.chatRepo.findSessionById(sessionId);
        if (!session) throw new NotFoundError('Chat session');
        return await this.chatRepo.getMessagesBySession(sessionId);
    }

    async endSession(sessionId) {
        const session = await this.chatRepo.findSessionById(sessionId);
        if (!session) throw new NotFoundError('Chat session');
        return await this.chatRepo.endSession(sessionId);
    }

    async sendMessage(sessionId, userMessage) {
        if (!userMessage || userMessage.trim().length === 0) {
            throw new ValidationError('Message cannot be empty');
        }

        const session = await this.chatRepo.findSessionById(sessionId);
        if (!session) throw new NotFoundError('Chat session');
        if (!session.is_active) throw new ValidationError('Chat session has ended');

        const intentResult = resolveIntent(userMessage);
        logger.info({ sessionId, intent: intentResult.intent, keyword: intentResult.matchedKeyword }, 'Intent resolved');

        await this.chatRepo.addMessage(sessionId, 'user', userMessage, intentResult.intent);

        let response;
        switch (intentResult.intent) {
            case 'CHECK_STOCK':
                response = await this._handleCheckStock(sessionId, userMessage);
                break;
            case 'CHECK_PRICE':
                response = await this._handleCheckPrice(sessionId, userMessage);
                break;
            case 'ORDER_STATUS':
                response = await this._handleOrderStatus(sessionId, userMessage);
                break;
            case 'SEARCH_PRODUCT':
                response = await this._handleSearchProduct(sessionId, userMessage);
                break;
            case 'HELP':
                response = this._handleHelp();
                break;
            case 'FREE_CHAT':
            default:
                response = await this._handleFreeChat(sessionId, userMessage);
                break;
        }

        await this.chatRepo.addMessage(sessionId, 'assistant', response.content, intentResult.intent, {
            model: response.model || null,
            latencyMs: response.latencyMs || null,
            intent: intentResult.intent,
            apiCalled: response.apiCalled || null,
            error: response.error || null
        });

        return {
            intent: intentResult.intent,
            reply: response.content,
            metadata: {
                model: response.model,
                latencyMs: response.latencyMs,
                intent: intentResult,
                apiCalled: response.apiCalled || null
            }
        };
    }

    // ── Data Intent Handlers ─────────────────────

    async _handleCheckStock(sessionId, userMessage) {
        const keyword = this._extractKeyword(userMessage, ['tồn kho', 'còn hàng', 'còn không', 'hết hàng', 'có còn', 'stock']);

        if (!this.apiClient) return this._fallbackNoApi('CHECK_STOCK', keyword);

        const searchResult = await this.apiClient.searchProducts(keyword);
        if (!searchResult.success || !searchResult.data?.products?.length) {
            return this._enrichWithAI(sessionId, userMessage,
                `[DATA] Không tìm thấy sản phẩm "${keyword}" trong hệ thống.`);
        }

        const product = searchResult.data.products[0];
        const stockResult = await this.apiClient.getInventorySummary(null, product.id);

        let stockInfo;
        if (stockResult.success && stockResult.data?.summary?.length) {
            const stock = stockResult.data.summary[0];
            stockInfo = `Sản phẩm "${product.name}" (ID: ${product.id}): ` +
                `On-hand: ${stock.quantity_on_hand || 0}, On-shelf: ${stock.quantity_on_shelf || 0}`;
        } else {
            stockInfo = `Sản phẩm "${product.name}" (ID: ${product.id}): Chưa có dữ liệu tồn kho.`;
        }

        return this._enrichWithAI(sessionId, userMessage,
            `[DATA] ${stockInfo}`, 'inventory:summary');
    }

    async _handleCheckPrice(sessionId, userMessage) {
        const keyword = this._extractKeyword(userMessage, ['giá', 'bao nhiêu', 'price', 'giá bán', 'giá tiền']);

        if (!this.apiClient) return this._fallbackNoApi('CHECK_PRICE', keyword);

        const searchResult = await this.apiClient.searchProducts(keyword);
        if (!searchResult.success || !searchResult.data?.products?.length) {
            return this._enrichWithAI(sessionId, userMessage,
                `[DATA] Không tìm thấy sản phẩm "${keyword}" trong hệ thống.`);
        }

        const products = searchResult.data.products.slice(0, 5);
        const priceList = products.map(p =>
            `- ${p.name}: ${Number(p.selling_price || p.price || 0).toLocaleString('vi-VN')}đ`
        ).join('\n');

        return this._enrichWithAI(sessionId, userMessage,
            `[DATA] Kết quả tìm kiếm giá:\n${priceList}`, 'catalog:products');
    }

    async _handleOrderStatus(sessionId, userMessage) {
        const orderId = this._extractOrderId(userMessage);

        if (!this.apiClient) return this._fallbackNoApi('ORDER_STATUS', orderId);

        if (orderId) {
            const result = await this.apiClient.getOrderById(orderId);
            if (result.success && result.data?.order) {
                const o = result.data.order;
                const info = `Đơn hàng #${o.id}: Trạng thái: ${o.status}, ` +
                    `Thanh toán: ${o.payment_status}, Tổng: ${Number(o.total_amount || 0).toLocaleString('vi-VN')}đ`;
                return this._enrichWithAI(sessionId, userMessage, `[DATA] ${info}`, 'order:detail');
            }
            return this._enrichWithAI(sessionId, userMessage,
                `[DATA] Không tìm thấy đơn hàng #${orderId}.`);
        }

        const result = await this.apiClient.getOrders();
        if (result.success && result.data?.orders?.length) {
            const recent = result.data.orders.slice(0, 5);
            const list = recent.map(o =>
                `- #${o.id}: ${o.status} | ${o.payment_status} | ${Number(o.total_amount || 0).toLocaleString('vi-VN')}đ`
            ).join('\n');
            return this._enrichWithAI(sessionId, userMessage,
                `[DATA] ${recent.length} đơn hàng gần nhất:\n${list}`, 'order:list');
        }

        return this._enrichWithAI(sessionId, userMessage, `[DATA] Chưa có đơn hàng nào.`);
    }

    async _handleSearchProduct(sessionId, userMessage) {
        const keyword = this._extractKeyword(userMessage, ['tìm', 'search', 'gợi ý', 'có gì', 'sản phẩm nào']);

        if (!this.apiClient) return this._fallbackNoApi('SEARCH_PRODUCT', keyword);

        const result = await this.apiClient.searchProducts(keyword);
        if (!result.success || !result.data?.products?.length) {
            return this._enrichWithAI(sessionId, userMessage,
                `[DATA] Không tìm thấy sản phẩm nào với từ khóa "${keyword}".`);
        }

        const products = result.data.products.slice(0, 8);
        const list = products.map(p =>
            `- ${p.name} | ${Number(p.selling_price || p.price || 0).toLocaleString('vi-VN')}đ | ${p.is_active ? 'Đang bán' : 'Ngừng bán'}`
        ).join('\n');

        return this._enrichWithAI(sessionId, userMessage,
            `[DATA] Tìm thấy ${result.data.products.length} sản phẩm:\n${list}`, 'catalog:search');
    }

    // ── Helpers ──────────────────────────────────

    _extractKeyword(message, triggerWords) {
        const lower = message.toLowerCase();
        for (const trigger of triggerWords) {
            const idx = lower.indexOf(trigger);
            if (idx !== -1) {
                const after = message.substring(idx + trigger.length).trim();
                const before = message.substring(0, idx).trim();
                const keyword = after || before;
                return keyword.replace(/[?!.,;:]/g, '').trim() || message;
            }
        }
        return message;
    }

    _extractOrderId(message) {
        const match = message.match(/#?(\d{1,10})/);
        return match ? match[1] : null;
    }

    async _enrichWithAI(sessionId, userMessage, dataContext, apiCalled = null) {
        const chatHistory = await this.chatRepo.getRecentContext(sessionId, 5);
        const messages = [
            ...chatHistory.map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: `${userMessage}\n\n${dataContext}\n\nDựa trên dữ liệu trên, hãy trả lời user bằng tiếng Việt, ngắn gọn và thân thiện.` }
        ];

        const aiResponse = await this.hfClient.chatCompletion(messages);
        return { ...aiResponse, apiCalled };
    }

    _fallbackNoApi(intent, keyword) {
        return {
            content: `Tôi hiểu bạn muốn ${intent === 'CHECK_STOCK' ? 'kiểm tra tồn kho' :
                intent === 'CHECK_PRICE' ? 'kiểm tra giá' :
                intent === 'ORDER_STATUS' ? 'tra cứu đơn hàng' :
                'tìm sản phẩm'}${keyword ? ` "${keyword}"` : ''}. ` +
                `Hiện tại hệ thống đang kết nối, vui lòng thử lại sau.`,
            model: null,
            latencyMs: 0,
            apiCalled: null
        };
    }

    _handleHelp() {
        const helpText = `Xin chào! Tôi là POSMART Assistant. Tôi có thể giúp bạn:

🔍 **Kiểm tra tồn kho** — Hỏi "Sản phẩm X còn hàng không?"
💰 **Kiểm tra giá** — Hỏi "Giá sản phẩm Y bao nhiêu?"
📦 **Trạng thái đơn hàng** — Hỏi "Đơn hàng #123 đến đâu rồi?"
🛒 **Tìm sản phẩm** — Hỏi "Tìm sản phẩm giống nước rửa tay"
💬 **Trò chuyện** — Hỏi bất cứ điều gì khác!

Bạn cần giúp gì?`;

        return { content: helpText, model: null, latencyMs: 0 };
    }

    async _handleFreeChat(sessionId, userMessage) {
        const chatHistory = await this.chatRepo.getRecentContext(sessionId, 8);
        const messages = [
            ...chatHistory.map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: userMessage }
        ];

        return await this.hfClient.chatCompletion(messages);
    }
}

module.exports = ChatService;
