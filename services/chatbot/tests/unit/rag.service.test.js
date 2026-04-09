/**
 * RAGService Unit Tests
 * Tests 7-step pipeline: Reformulate → Embed → Hybrid Search → RRF → CoPurchase → Personalize → Generate
 */

jest.mock('../../../../shared/common/logger', () => ({
    info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn()
}));

const RAGService = require('../../src/services/rag.service');

describe('RAGService', () => {
    let ragService;
    let mockKnowledgeRepo, mockCopurchaseRepo, mockEmbeddingClient;
    let mockHfClient, mockApiClient, mockReformulator;

    // Reusable test fixtures
    const MOCK_VECTOR = new Array(768).fill(0.01);
    const MOCK_SEMANTIC_RESULTS = [
        { product_id: 42, store_id: 1, content: 'Sản phẩm "Bia Tiger"', category_name: 'Đồ uống', unit_price: 15000, is_in_stock: true, quantity_on_shelf: 24, score: 0.92 },
        { product_id: 55, store_id: 1, content: 'Sản phẩm "Bia Heineken"', category_name: 'Đồ uống', unit_price: 22000, is_in_stock: true, quantity_on_shelf: 18, score: 0.88 },
        { product_id: 60, store_id: 1, content: 'Sản phẩm "Coca Cola"', category_name: 'Nước giải khát', unit_price: 12000, is_in_stock: true, quantity_on_shelf: 30, score: 0.75 }
    ];
    const MOCK_KEYWORD_RESULTS = [
        { product_id: 42, store_id: 1, content: 'Sản phẩm "Bia Tiger"', category_name: 'Đồ uống', unit_price: 15000, is_in_stock: true, quantity_on_shelf: 24, score: 0.95 },
        { product_id: 70, store_id: 1, content: 'Sản phẩm "Tiger Crystal"', category_name: 'Đồ uống', unit_price: 18000, is_in_stock: true, quantity_on_shelf: 12, score: 0.80 }
    ];

    beforeEach(() => {
        mockKnowledgeRepo = {
            searchSemantic: jest.fn().mockResolvedValue(MOCK_SEMANTIC_RESULTS),
            searchKeyword: jest.fn().mockResolvedValue(MOCK_KEYWORD_RESULTS)
        };

        mockCopurchaseRepo = {
            getRelatedProducts: jest.fn().mockResolvedValue([
                { product_id_b: 99, co_purchase_count: 8 }
            ])
        };

        mockEmbeddingClient = {
            embed: jest.fn().mockResolvedValue(MOCK_VECTOR)
        };

        mockHfClient = {
            client: {
                chatCompletion: jest.fn().mockResolvedValue({
                    choices: [{ message: { content: 'Chào bạn! Mình gợi ý Bia Tiger 15.000đ.' } }]
                })
            },
            model: 'test-model'
        };

        mockApiClient = {
            getCustomerProfile: jest.fn().mockResolvedValue({
                success: true,
                data: { customerType: 'vip', totalSpent: 6000000 }
            })
        };

        mockReformulator = {
            reformulate: jest.fn().mockImplementation(msg => msg)
        };

        ragService = new RAGService({
            knowledgeRepo: mockKnowledgeRepo,
            copurchaseRepo: mockCopurchaseRepo,
            embeddingClient: mockEmbeddingClient,
            hfClient: mockHfClient,
            apiClient: mockApiClient,
            reformulator: mockReformulator
        });
    });

    // ── RRF Algorithm ─────────────────────────────────

    describe('_reciprocalRankFusion', () => {
        it('should give highest score to items appearing in both lists', () => {
            const fused = ragService._reciprocalRankFusion(MOCK_SEMANTIC_RESULTS, MOCK_KEYWORD_RESULTS);

            // Product 42 appears in both → highest score
            const product42 = fused.find(r => r.product_id === 42);
            const product55 = fused.find(r => r.product_id === 55);

            expect(product42.rrf_score).toBeGreaterThan(product55.rrf_score);
        });

        it('should rank single-list items lower than dual-list items', () => {
            const fused = ragService._reciprocalRankFusion(MOCK_SEMANTIC_RESULTS, MOCK_KEYWORD_RESULTS);

            const dualItem = fused.find(r => r.product_id === 42);  // In both
            const singleItem = fused.find(r => r.product_id === 60); // Only semantic

            expect(dualItem.rrf_score).toBeGreaterThan(singleItem.rrf_score);
        });

        it('should return empty array for empty inputs', () => {
            const fused = ragService._reciprocalRankFusion([], []);
            expect(fused).toEqual([]);
        });

        it('should apply k=60 parameter correctly', () => {
            const single = [{ product_id: 1, store_id: 1 }];
            const fused = ragService._reciprocalRankFusion(single, []);

            // rank=0 → score = 1/(60+0+1) = 1/61
            expect(fused[0].rrf_score).toBeCloseTo(1 / 61, 6);
        });
    });

    // ── Pipeline ──────────────────────────────────────

    describe('recommend (full pipeline)', () => {
        it('should complete 7-step pipeline and return products', async () => {
            const result = await ragService.recommend('Gợi ý bia ngon', 1, 100, []);

            // Step 1: reformulate called
            expect(mockReformulator.reformulate).toHaveBeenCalledWith('Gợi ý bia ngon', []);

            // Step 2: embed called
            expect(mockEmbeddingClient.embed).toHaveBeenCalled();

            // Step 3: both searches called in parallel
            expect(mockKnowledgeRepo.searchSemantic).toHaveBeenCalledWith(MOCK_VECTOR, 1, 10);
            expect(mockKnowledgeRepo.searchKeyword).toHaveBeenCalledWith('Gợi ý bia ngon', 1, 10);

            // Step 5: co-purchase called
            expect(mockCopurchaseRepo.getRelatedProducts).toHaveBeenCalled();

            // Step 6: personalization called
            expect(mockApiClient.getCustomerProfile).toHaveBeenCalledWith(100);

            // Output structure
            expect(result.content).toBeDefined();
            expect(result.productIds).toEqual(expect.arrayContaining([42]));
            expect(result.products.length).toBeGreaterThan(0);
            expect(result.metadata.totalLatencyMs).toBeDefined();
        });

        it('should return noResults when hybrid search finds nothing', async () => {
            mockKnowledgeRepo.searchSemantic.mockResolvedValue([]);
            mockKnowledgeRepo.searchKeyword.mockResolvedValue([]);

            const result = await ragService.recommend('XYZ không tồn tại', 1);

            expect(result.productIds).toEqual([]);
            expect(result.content).toContain('không tìm thấy');
        });

        it('should handle embedding error gracefully', async () => {
            mockEmbeddingClient.embed.mockRejectedValue(new Error('ONNX Runtime error'));

            const result = await ragService.recommend('Test error', 1);

            expect(result.content).toContain('sự cố');
            expect(result.productIds).toEqual([]);
            expect(result.metadata.error).toBe('ONNX Runtime error');
        });

        it('should record latency for each step in metadata', async () => {
            const result = await ragService.recommend('Gợi ý bia', 1);

            expect(result.metadata.steps.reformulation).toHaveProperty('latencyMs');
            expect(result.metadata.steps.embedding).toHaveProperty('latencyMs');
            expect(result.metadata.steps.search).toHaveProperty('latencyMs');
            expect(result.metadata.steps.fusion).toHaveProperty('top5Scores');
            expect(result.metadata.steps.generation).toHaveProperty('latencyMs');
        });

        it('should extract product names from content field', async () => {
            const result = await ragService.recommend('Gợi ý bia', 1);

            const tigerProduct = result.products.find(p => p.id === 42);
            expect(tigerProduct.name).toBe('Bia Tiger');
        });
    });

    // ── Co-purchase ───────────────────────────────────

    describe('_getCoPurchaseContext', () => {
        it('should lookup related products for top 3 only', async () => {
            const top5 = MOCK_SEMANTIC_RESULTS.slice(0, 5);
            await ragService._getCoPurchaseContext(top5, 1);

            // Should only lookup first 3 products (slice(0, 3))
            expect(mockCopurchaseRepo.getRelatedProducts).toHaveBeenCalledTimes(3);
        });

        it('should return empty array when copurchaseRepo is null', async () => {
            ragService.copurchaseRepo = null;
            const result = await ragService._getCoPurchaseContext(MOCK_SEMANTIC_RESULTS, 1);
            expect(result).toEqual([]);
        });
    });

    // ── Personalization ───────────────────────────────

    describe('_getPersonalizationContext', () => {
        it('should return VIP prompt for VIP customer', async () => {
            const ctx = await ragService._getPersonalizationContext(100);
            expect(ctx.type).toBe('vip');
            expect(ctx.prompt).toContain('VIP');
        });

        it('should return wholesale prompt for wholesale customer', async () => {
            mockApiClient.getCustomerProfile.mockResolvedValue({
                success: true,
                data: { customerType: 'wholesale', totalSpent: 2000000 }
            });

            const ctx = await ragService._getPersonalizationContext(200);
            expect(ctx.type).toBe('wholesale');
            expect(ctx.prompt).toContain('sỉ');
        });

        it('should return retail default when no customerId', async () => {
            const ctx = await ragService._getPersonalizationContext(null);
            expect(ctx.type).toBe('retail');
            expect(mockApiClient.getCustomerProfile).not.toHaveBeenCalled();
        });

        it('should fallback to retail on API failure', async () => {
            mockApiClient.getCustomerProfile.mockRejectedValue(new Error('Connection refused'));

            const ctx = await ragService._getPersonalizationContext(100);
            expect(ctx.type).toBe('retail');
        });
    });

    // ── Generation ────────────────────────────────────

    describe('_generateResponse', () => {
        it('should include product data in system prompt', async () => {
            await ragService._generateResponse('Gợi ý bia', 'Gợi ý bia', MOCK_SEMANTIC_RESULTS, [], { type: 'retail', prompt: '' });

            const callArgs = mockHfClient.client.chatCompletion.mock.calls[0][0];
            const systemPrompt = callArgs.messages[0].content;

            expect(systemPrompt).toContain('Bia Tiger');
            expect(systemPrompt).toContain('15.000');
        });

        it('should include co-purchase data in prompt when available', async () => {
            const coPurchaseData = [{
                productId: 42,
                productName: 'Bia Tiger',
                relatedProducts: [{ product_id_b: 99, co_purchase_count: 8 }]
            }];

            await ragService._generateResponse('Gợi ý bia', 'Gợi ý bia', MOCK_SEMANTIC_RESULTS, coPurchaseData, { type: 'retail', prompt: '' });

            const callArgs = mockHfClient.client.chatCompletion.mock.calls[0][0];
            const systemPrompt = callArgs.messages[0].content;

            expect(systemPrompt).toContain('mua kèm');
        });

        it('should return fallback when LLM fails', async () => {
            mockHfClient.client.chatCompletion.mockRejectedValue(new Error('Rate limited'));

            const result = await ragService._generateResponse('Test', 'Test', MOCK_SEMANTIC_RESULTS, [], { type: 'retail', prompt: '' });

            expect(result.content).toContain('Bia Tiger');
            expect(result.content).toContain('15.000');
        });

        it('should use VIP greeting in fallback for VIP customers', () => {
            const response = ragService._buildFallbackResponse(MOCK_SEMANTIC_RESULTS, { type: 'vip' });
            expect(response).toContain('VIP');
        });
    });
});
