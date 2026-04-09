/**
 * DataIngestionService Unit Tests
 * Tests: event handlers, cron sync, idempotency, content template
 */

jest.mock('../../../../shared/common/logger', () => ({
    info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn()
}));

const DataIngestionService = require('../../src/services/data-ingestion.service');

describe('DataIngestionService', () => {
    let service;
    let mockPool, mockEmbeddingClient, mockApiClient;

    const MOCK_VECTOR = new Array(768).fill(0.01);

    beforeEach(() => {
        mockPool = {
            query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 })
        };

        mockEmbeddingClient = {
            embed: jest.fn().mockResolvedValue(MOCK_VECTOR)
        };

        mockApiClient = {
            getAllProducts: jest.fn(),
            getStoreInventory: jest.fn(),
            getInventorySummary: jest.fn(),
            getStores: jest.fn().mockResolvedValue({
                success: true,
                data: { stores: [{ id: 1 }, { id: 2 }] }
            }),
            getCustomerProfile: jest.fn()
        };

        service = new DataIngestionService(mockPool, mockEmbeddingClient, mockApiClient);
    });

    // ── Event Handlers ────────────────────────────────

    describe('handleProductCreated', () => {
        const message = {
            id: 'evt-001',
            type: 'product.created',
            data: {
                productId: 42, name: 'Coca Cola', categoryName: 'Nước giải khát',
                unitPrice: 12000, vendor: 'Coca-Cola Vietnam'
            }
        };

        it('should embed and upsert for all stores', async () => {
            // _isProcessed → INSERT succeeds (not processed)
            mockPool.query.mockResolvedValueOnce({ rows: [] });

            // _getStoreIds → Auth API returns 2 stores
            // apiClient.getStores already mocked in beforeEach

            // _fetchInventoryForProduct → no inventory
            mockApiClient.getInventorySummary.mockResolvedValue({ success: true, data: [] });

            // _upsertKnowledge → pool.query for UPSERT (called per store)
            // _markProcessed → pool.query for UPDATE

            await service.handleProductCreated(message);

            // Should embed for each store
            expect(mockEmbeddingClient.embed).toHaveBeenCalledTimes(2);
            // Embedded content should contain product name
            const embedCall = mockEmbeddingClient.embed.mock.calls[0][0];
            expect(embedCall).toContain('Coca Cola');
            expect(embedCall).toContain('Nước giải khát');
        });

        it('should skip if already processed (idempotency)', async () => {
            // _isProcessed → INSERT throws 23505 (duplicate)
            mockPool.query.mockRejectedValueOnce({ code: '23505' });

            await service.handleProductCreated(message);

            // Should not call embed
            expect(mockEmbeddingClient.embed).not.toHaveBeenCalled();
        });
    });

    describe('handleProductDeleted', () => {
        it('should DELETE from knowledge base', async () => {
            const message = { id: 'evt-003', type: 'product.deleted', data: { productId: 42 } };

            // _isProcessed → not processed
            mockPool.query.mockResolvedValueOnce({ rows: [] });

            await service.handleProductDeleted(message);

            // Should call DELETE query
            const deleteCalls = mockPool.query.mock.calls.filter(c =>
                typeof c[0] === 'string' && c[0].includes('DELETE')
            );
            expect(deleteCalls.length).toBe(1);
            expect(deleteCalls[0][1]).toEqual([42]);
        });
    });

    describe('handleInventoryUpdated', () => {
        const baseMessage = {
            id: 'evt-inv-001', type: 'inventory.updated',
            data: { storeId: 1, productId: 42, quantityOnShelf: 10, isInStock: true }
        };

        it('should re-embed when is_in_stock changes', async () => {
            // _isProcessed → not processed
            mockPool.query.mockResolvedValueOnce({ rows: [] });

            // SELECT existing record — was out of stock
            mockPool.query.mockResolvedValueOnce({
                rows: [{
                    content: 'Sản phẩm "Coca Cola"', category_name: 'Nước giải khát',
                    unit_price: 12000, is_in_stock: false, quantity_on_shelf: 0
                }]
            });

            await service.handleInventoryUpdated(baseMessage);

            // Should call embed (re-embed due to stock status change)
            expect(mockEmbeddingClient.embed).toHaveBeenCalled();
        });

        it('should light-update when only quantity changes', async () => {
            // _isProcessed → not processed
            mockPool.query.mockResolvedValueOnce({ rows: [] });

            // SELECT existing — same is_in_stock=true
            mockPool.query.mockResolvedValueOnce({
                rows: [{
                    content: 'Sản phẩm "Coca Cola"', category_name: 'Nước giải khát',
                    unit_price: 12000, is_in_stock: true, quantity_on_shelf: 20
                }]
            });

            await service.handleInventoryUpdated(baseMessage);

            // Should NOT call embed (light update)
            expect(mockEmbeddingClient.embed).not.toHaveBeenCalled();

            // Should call UPDATE for qty
            const updateCalls = mockPool.query.mock.calls.filter(c =>
                typeof c[0] === 'string' && c[0].includes('UPDATE product_knowledge_base')
            );
            expect(updateCalls.length).toBe(1);
        });

        it('should skip for unknown product', async () => {
            // _isProcessed → not processed
            mockPool.query.mockResolvedValueOnce({ rows: [] });

            // SELECT existing — no rows
            mockPool.query.mockResolvedValueOnce({ rows: [] });

            await service.handleInventoryUpdated(baseMessage);

            expect(mockEmbeddingClient.embed).not.toHaveBeenCalled();
        });
    });

    describe('handleOrderCompleted', () => {
        it('should create sorted co-purchase pairs', async () => {
            const message = {
                id: 'evt-ord-001', type: 'order.completed',
                data: { storeId: 1, items: [{ productId: 42 }, { productId: 15 }, { productId: 37 }] }
            };

            // _isProcessed → not processed
            mockPool.query.mockResolvedValueOnce({ rows: [] });

            await service.handleOrderCompleted(message);

            // 3 items → 3 pairs: (15,37), (15,42), (37,42) — sorted
            const insertCalls = mockPool.query.mock.calls.filter(c =>
                typeof c[0] === 'string' && c[0].includes('INSERT INTO co_purchase_stats')
            );
            expect(insertCalls.length).toBe(3);

            // Verify sorted pairs
            const pairs = insertCalls.map(c => [c[1][0], c[1][1]]);
            for (const [a, b] of pairs) {
                expect(a).toBeLessThan(b);
            }
        });

        it('should skip orders with < 2 items', async () => {
            const message = {
                id: 'evt-ord-002', type: 'order.completed',
                data: { storeId: 1, items: [{ productId: 42 }] }
            };

            // _isProcessed → not processed
            mockPool.query.mockResolvedValueOnce({ rows: [] });

            await service.handleOrderCompleted(message);

            const insertCalls = mockPool.query.mock.calls.filter(c =>
                typeof c[0] === 'string' && c[0].includes('INSERT INTO co_purchase_stats')
            );
            expect(insertCalls.length).toBe(0);
        });
    });

    // ── Cron Sync ─────────────────────────────────────

    describe('syncAll', () => {
        it('should fetch products + inventory and upsert all', async () => {
            mockApiClient.getAllProducts.mockResolvedValue({
                success: true,
                data: {
                    products: [
                        { id: 1, name: 'Coca Cola', categoryName: 'Nước', unitPrice: 12000, isActive: true },
                        { id: 2, name: 'Pepsi', categoryName: 'Nước', unitPrice: 11000, isActive: true }
                    ]
                }
            });
            mockApiClient.getStoreInventory.mockResolvedValue({
                success: true,
                data: [{ productId: 1, quantityOnShelf: 10 }, { productId: 2, quantityOnShelf: 5 }]
            });

            const result = await service.syncAll();

            // 2 stores × 2 products = 4 embeds
            expect(mockEmbeddingClient.embed).toHaveBeenCalledTimes(4);
            expect(result.synced).toBe(4);
            expect(result.skipped).toBe(0);
        });

        it('should skip inactive products', async () => {
            mockApiClient.getAllProducts.mockResolvedValue({
                success: true,
                data: {
                    products: [
                        { id: 1, name: 'Active', unitPrice: 1000, isActive: true },
                        { id: 2, name: 'Inactive', unitPrice: 2000, isActive: false }
                    ]
                }
            });
            mockApiClient.getStoreInventory.mockResolvedValue({ success: true, data: [] });

            const result = await service.syncAll();

            // Only active product synced per store (2 stores × 1 product)
            expect(result.synced).toBe(2);
            expect(result.skipped).toBe(2); // 2 stores × 1 inactive
        });

        it('should handle empty catalog gracefully', async () => {
            mockApiClient.getAllProducts.mockResolvedValue({
                success: true, data: { products: [] }
            });

            const result = await service.syncAll();

            expect(result.synced).toBe(0);
            expect(mockEmbeddingClient.embed).not.toHaveBeenCalled();
        });
    });

    // ── Helpers ───────────────────────────────────────

    describe('_buildContentText', () => {
        it('should format Vietnamese text with keywords', () => {
            const text = service._buildContentText('Coca Cola', 'Nước giải khát', 12000, 'CocaCola VN', true, 48);

            expect(text).toContain('Sản phẩm "Coca Cola"');
            expect(text).toContain('danh mục "Nước giải khát"');
            expect(text).toContain('giá');
            expect(text).toContain('12.000');
            expect(text).toContain('nhà cung cấp "CocaCola VN"');
            expect(text).toContain('hiện còn 48 sản phẩm trên kệ');
            expect(text).toContain('Từ khóa:');
        });

        it('should show "hết hàng" when not in stock', () => {
            const text = service._buildContentText('Test', 'Cat', 1000, null, false, 0);
            expect(text).toContain('hết hàng');
            expect(text).not.toContain('nhà cung cấp');
        });
    });

    describe('_extractKeywords', () => {
        it('should generate diacritics-free keywords', () => {
            const keywords = service._extractKeywords('Bía Tígẹr', 'Sabeco');

            expect(keywords).toContain('bia');
            expect(keywords).toContain('tiger');
            expect(keywords).toContain('sabeco');
        });
    });

    describe('_isProcessed', () => {
        it('should return false on first insert', async () => {
            mockPool.query.mockResolvedValueOnce({ rows: [] });
            const result = await service._isProcessed('evt-new');
            expect(result).toBe(false);
        });

        it('should return true on duplicate (23505)', async () => {
            mockPool.query.mockRejectedValueOnce({ code: '23505' });
            const result = await service._isProcessed('evt-dup');
            expect(result).toBe(true);
        });

        it('should throw on other errors', async () => {
            mockPool.query.mockRejectedValueOnce(new Error('Connection lost'));
            await expect(service._isProcessed('evt-err')).rejects.toThrow('Connection lost');
        });
    });

    describe('_buildInventoryMap', () => {
        it('should build Map from array response', () => {
            const result = { success: true, data: [
                { productId: 1, quantityOnShelf: 10, quantityOnHand: 15 },
                { productId: 2, quantityOnShelf: 0, quantityOnHand: 0 }
            ]};

            const map = service._buildInventoryMap(result);

            expect(map.get('1').totalOnShelf).toBe(10);
            expect(map.get('1').isInStock).toBe(true);
            expect(map.get('2').totalOnShelf).toBe(0);
            expect(map.get('2').isInStock).toBe(false);
        });

        it('should return empty Map for failed response', () => {
            const map = service._buildInventoryMap({ success: false });
            expect(map.size).toBe(0);
        });
    });
});
