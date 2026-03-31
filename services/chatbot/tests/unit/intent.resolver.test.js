const { resolveIntent, getAllIntents, INTENT_PATTERNS } = require('../../src/services/intent.resolver');

describe('Intent Resolver', () => {
    describe('resolveIntent', () => {
        it('should detect CHECK_STOCK intent', () => {
            const result = resolveIntent('Sản phẩm Coca Cola còn hàng không?');
            expect(result.intent).toBe('CHECK_STOCK');
            expect(result.matchedKeyword).toBe('còn hàng');
        });

        it('should detect CHECK_STOCK with "tồn kho"', () => {
            const result = resolveIntent('Kiểm tra tồn kho mì gói');
            expect(result.intent).toBe('CHECK_STOCK');
        });

        it('should detect CHECK_PRICE intent', () => {
            const result = resolveIntent('Nước ngọt Pepsi giá bao nhiêu?');
            expect(result.intent).toBe('CHECK_PRICE');
            expect(result.matchedKeyword).toBe('giá');
        });

        it('should detect ORDER_STATUS intent', () => {
            const result = resolveIntent('Đơn hàng #123 đang ở đâu rồi?');
            expect(result.intent).toBe('ORDER_STATUS');
        });

        it('should detect SEARCH_PRODUCT intent', () => {
            const result = resolveIntent('Tìm sản phẩm giống nước rửa tay');
            expect(result.intent).toBe('SEARCH_PRODUCT');
        });

        it('should detect HELP intent', () => {
            const result = resolveIntent('Hướng dẫn sử dụng ứng dụng');
            expect(result.intent).toBe('HELP');
        });

        it('should return FREE_CHAT for unrecognized messages', () => {
            const result = resolveIntent('Hôm nay trời đẹp quá');
            expect(result.intent).toBe('FREE_CHAT');
            expect(result.confidence).toBe('default');
            expect(result.matchedKeyword).toBeNull();
        });

        it('should be case-insensitive', () => {
            const result = resolveIntent('STOCK còn không?');
            expect(result.intent).toBe('CHECK_STOCK');
        });

        it('should handle empty string', () => {
            const result = resolveIntent('');
            expect(result.intent).toBe('FREE_CHAT');
        });

        it('should prioritize first matching intent', () => {
            // "giá" matches CHECK_PRICE before "tìm" matches SEARCH
            const result = resolveIntent('giá sản phẩm này');
            expect(result.intent).toBe('CHECK_PRICE');
        });
    });

    describe('getAllIntents', () => {
        it('should return all defined intents', () => {
            const intents = getAllIntents();
            expect(intents.length).toBe(Object.keys(INTENT_PATTERNS).length);
            expect(intents[0]).toHaveProperty('intent');
            expect(intents[0]).toHaveProperty('keywords');
            expect(intents[0]).toHaveProperty('description');
        });
    });
});
