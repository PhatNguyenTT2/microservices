/**
 * KnowledgeRepository Unit Tests
 * Tests: dual search (pgvector cosine + tsvector FTS), UPSERT, stats
 */

jest.mock('../../../../shared/common/logger', () => ({
    info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn()
}));

const KnowledgeRepository = require('../../src/repositories/knowledge.repository');

describe('KnowledgeRepository', () => {
    let repo;
    let mockPool;

    const MOCK_VECTOR = new Array(768).fill(0.01);
    const MOCK_ROWS = [
        { product_id: 42, store_id: 1, content: 'Bia Tiger', category_name: 'Đồ uống', unit_price: 15000, is_in_stock: true, quantity_on_shelf: 24, score: 0.92 }
    ];

    beforeEach(() => {
        mockPool = {
            query: jest.fn().mockResolvedValue({ rows: MOCK_ROWS, rowCount: 1 })
        };
        repo = new KnowledgeRepository(mockPool);
    });

    describe('searchSemantic', () => {
        it('should query with vector and filter store_id + is_in_stock', async () => {
            const results = await repo.searchSemantic(MOCK_VECTOR, 1, 5);

            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('embedding <=>'),
                expect.arrayContaining([expect.stringContaining('['), 1, 5])
            );
            expect(results).toEqual(MOCK_ROWS);
        });

        it('should return rows with cosine similarity score', async () => {
            const results = await repo.searchSemantic(MOCK_VECTOR, 1);

            const query = mockPool.query.mock.calls[0][0];
            expect(query).toContain('1 - (embedding <=>');
            expect(query).toContain('is_in_stock = TRUE');
            expect(results[0].score).toBeDefined();
        });
    });

    describe('searchKeyword', () => {
        it('should query with plainto_tsquery and filter', async () => {
            await repo.searchKeyword('bia tiger', 1, 5);

            const query = mockPool.query.mock.calls[0][0];
            expect(query).toContain("plainto_tsquery('simple'");
            expect(query).toContain('fts_content @@');
            expect(query).toContain('is_in_stock = TRUE');
        });

        it('should return empty for no match', async () => {
            mockPool.query.mockResolvedValueOnce({ rows: [] });

            const results = await repo.searchKeyword('xyz_nonexistent', 1);
            expect(results).toEqual([]);
        });
    });

    describe('upsertKnowledge', () => {
        it('should UPSERT with ON CONFLICT', async () => {
            await repo.upsertKnowledge({
                productId: 42, storeId: 1, content: 'Test', embedding: MOCK_VECTOR,
                categoryName: 'Cat', unitPrice: 1000, isInStock: true, qtyOnShelf: 10
            });

            const query = mockPool.query.mock.calls[0][0];
            expect(query).toContain('INSERT INTO product_knowledge_base');
            expect(query).toContain('ON CONFLICT (product_id, store_id)');
            expect(query).toContain('DO UPDATE SET');
        });
    });

    describe('deleteByProductId', () => {
        it('should return deleted rowCount', async () => {
            mockPool.query.mockResolvedValueOnce({ rowCount: 3 });
            const count = await repo.deleteByProductId(42);
            expect(count).toBe(3);
            expect(mockPool.query).toHaveBeenCalledWith(
                expect.stringContaining('DELETE FROM product_knowledge_base'),
                [42]
            );
        });
    });

    describe('getStats', () => {
        it('should return aggregated counts', async () => {
            mockPool.query.mockResolvedValueOnce({
                rows: [{ total_entries: '150', in_stock_count: '120', out_of_stock_count: '30' }]
            });

            const stats = await repo.getStats();
            expect(stats.total_entries).toBe('150');
            // No WHERE clause when no storeId
            const query = mockPool.query.mock.calls[0][0];
            expect(query).not.toContain('WHERE store_id');
        });

        it('should filter by store when storeId provided', async () => {
            mockPool.query.mockResolvedValueOnce({ rows: [{ total_entries: '50' }] });

            await repo.getStats(1);

            const query = mockPool.query.mock.calls[0][0];
            expect(query).toContain('WHERE store_id');
            expect(mockPool.query).toHaveBeenCalledWith(expect.any(String), [1]);
        });
    });
});
