/**
 * QueryReformulator Unit Tests
 * Tests: pronoun detection, reformulation logic, error handling
 */

jest.mock('../../../../shared/common/logger', () => ({
    info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn()
}));

const QueryReformulator = require('../../src/services/query-reformulator');

describe('QueryReformulator', () => {
    let reformulator;
    let mockHfClient;

    beforeEach(() => {
        mockHfClient = {
            chatCompletion: jest.fn().mockResolvedValue({
                content: 'Bia Tiger 330ml còn hàng không?'
            })
        };
        reformulator = new QueryReformulator(mockHfClient);
    });

    describe('reformulate', () => {
        const mockHistory = [
            { role: 'user', content: 'Bia Tiger giá bao nhiêu?' },
            { role: 'assistant', content: 'Bia Tiger 330ml giá 15.000đ/lon.' }
        ];

        it('should return original if no pronouns detected', async () => {
            const result = await reformulator.reformulate('Cho tôi xem danh sách bia', mockHistory);

            expect(result).toBe('Cho tôi xem danh sách bia');
            expect(mockHfClient.chatCompletion).not.toHaveBeenCalled();
        });

        it('should return original if no chat history', async () => {
            const result = await reformulator.reformulate('Nó giá bao nhiêu?', []);

            expect(result).toBe('Nó giá bao nhiêu?');
            expect(mockHfClient.chatCompletion).not.toHaveBeenCalled();
        });

        it('should reformulate when "nó" detected with history', async () => {
            const result = await reformulator.reformulate('Nó còn hàng không?', mockHistory);

            expect(result).toBe('Bia Tiger 330ml còn hàng không?');
            expect(mockHfClient.chatCompletion).toHaveBeenCalled();
        });

        it('should reformulate when "cái đó" detected', async () => {
            const result = await reformulator.reformulate('Cái đó có tốt không?', mockHistory);

            expect(mockHfClient.chatCompletion).toHaveBeenCalled();
        });

        it('should return original if LLM returns too short result', async () => {
            mockHfClient.chatCompletion.mockResolvedValue({ content: 'Hi' }); // < 3 chars

            const result = await reformulator.reformulate('Nó giá bao nhiêu?', mockHistory);
            expect(result).toBe('Nó giá bao nhiêu?');
        });

        it('should return original if LLM call fails (graceful)', async () => {
            mockHfClient.chatCompletion.mockRejectedValue(new Error('Rate limit'));

            const result = await reformulator.reformulate('Nó giá bao nhiêu?', mockHistory);
            expect(result).toBe('Nó giá bao nhiêu?');
        });
    });

    describe('_needsReformulation', () => {
        it('should detect all Vietnamese pronouns', () => {
            const pronouns = ['nó', 'cái đó', 'cái này', 'loại này', 'món đó', 'sản phẩm đó', 'hàng đó'];

            for (const pronoun of pronouns) {
                expect(reformulator._needsReformulation(`${pronoun} giá bao nhiêu`)).toBe(true);
            }
        });

        it('should return false for clean queries', () => {
            expect(reformulator._needsReformulation('Bia Tiger giá bao nhiêu?')).toBe(false);
            expect(reformulator._needsReformulation('Tìm nước rửa tay')).toBe(false);
        });
    });
});
