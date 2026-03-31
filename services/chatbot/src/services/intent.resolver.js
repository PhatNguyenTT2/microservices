/**
 * Intent Resolver — Keyword/regex-based intent classification
 * Lightweight, no AI needed. Classifies user messages into actionable intents.
 */

const INTENT_PATTERNS = {
    CHECK_STOCK: {
        keywords: ['tồn kho', 'còn hàng', 'còn không', 'hết hàng', 'có còn', 'stock', 'inventory', 'số lượng còn'],
        description: 'Kiểm tra tồn kho sản phẩm'
    },
    CHECK_PRICE: {
        keywords: ['giá', 'bao nhiêu', 'price', 'giá bán', 'giá tiền', 'chi phí'],
        description: 'Kiểm tra giá sản phẩm'
    },
    ORDER_STATUS: {
        keywords: ['đơn hàng', 'order', 'tracking', 'giao hàng', 'trạng thái đơn', 'đơn #', 'mã đơn'],
        description: 'Kiểm tra trạng thái đơn hàng'
    },
    SEARCH_PRODUCT: {
        keywords: ['tìm', 'search', 'gợi ý', 'có gì', 'sản phẩm nào', 'recommend', 'loại nào'],
        description: 'Tìm kiếm sản phẩm'
    },
    HELP: {
        keywords: ['help', 'giúp', 'hướng dẫn', 'làm sao', 'cách', 'hỗ trợ'],
        description: 'Yêu cầu hỗ trợ'
    }
};

function resolveIntent(message) {
    const normalizedMsg = message.toLowerCase().trim();

    for (const [intent, config] of Object.entries(INTENT_PATTERNS)) {
        for (const keyword of config.keywords) {
            if (normalizedMsg.includes(keyword)) {
                return {
                    intent,
                    confidence: 'keyword_match',
                    matchedKeyword: keyword,
                    description: config.description
                };
            }
        }
    }

    return {
        intent: 'FREE_CHAT',
        confidence: 'default',
        matchedKeyword: null,
        description: 'Trò chuyện tự do với AI'
    };
}

function getAllIntents() {
    return Object.entries(INTENT_PATTERNS).map(([key, val]) => ({
        intent: key,
        keywords: val.keywords,
        description: val.description
    }));
}

module.exports = { resolveIntent, getAllIntents, INTENT_PATTERNS };
