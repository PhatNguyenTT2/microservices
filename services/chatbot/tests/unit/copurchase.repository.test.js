/**
 * CoPurchaseRepository Unit Tests
 * Tests: pair generation, bidirectional lookup, top pairs
 */

jest.mock('../../../../shared/common/logger', () => ({
    info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn()
}));

const CoPurchaseRepository = require('../../src/repositories/copurchase.repository');

describe('CoPurchaseRepository', () => {
    let repo;
    let mockPool;

    beforeEach(() => {
        mockPool = {
            query: jest.fn().mockResolvedValue({ rows: [] })
        };
        repo = new CoPurchaseRepository(mockPool);
    });

    describe('upsertPairs', () => {
        it('should create 3 sorted pairs from 3 product IDs', async () => {
            await repo.upsertPairs([42, 15, 37], 1);

            // 3 items → C(3,2) = 3 pairs
            const insertCalls = mockPool.query.mock.calls.filter(c =>
                c[0].includes('INSERT INTO co_purchase_stats')
            );
            expect(insertCalls.length).toBe(3);

            // Verify all pairs are sorted (A < B)
            for (const call of insertCalls) {
                expect(call[1][0]).toBeLessThan(call[1][1]); // product_id_a < product_id_b
                expect(call[1][2]).toBe(1); // store_id
            }
        });

        it('should deduplicate input IDs', async () => {
            await repo.upsertPairs([42, 42, 15], 1);

            // Only 1 pair after dedup: (15, 42)
            const insertCalls = mockPool.query.mock.calls.filter(c =>
                c[0].includes('INSERT INTO co_purchase_stats')
            );
            expect(insertCalls.length).toBe(1);
        });

        it('should skip if < 2 products', async () => {
            await repo.upsertPairs([42], 1);
            expect(mockPool.query).not.toHaveBeenCalled();

            await repo.upsertPairs([], 1);
            expect(mockPool.query).not.toHaveBeenCalled();

            await repo.upsertPairs(null, 1);
            expect(mockPool.query).not.toHaveBeenCalled();
        });
    });

    describe('getRelatedProducts', () => {
        it('should UNION both directions (bidirectional)', async () => {
            mockPool.query.mockResolvedValueOnce({
                rows: [{ product_id_b: 55, co_purchase_count: 8 }]
            });

            const results = await repo.getRelatedProducts(42, 1, 3);

            const query = mockPool.query.mock.calls[0][0];
            // Should have UNION for bidirectional lookup
            expect(query).toContain('UNION');
            expect(query).toContain('product_id_a = $1');
            expect(query).toContain('product_id_b = $1');
            expect(results).toHaveLength(1);
        });

        it('should respect minCount threshold', async () => {
            await repo.getRelatedProducts(42, 1, 5);

            const params = mockPool.query.mock.calls[0][1];
            expect(params).toContain(5); // minCount
        });
    });

    describe('getTopPairs', () => {
        it('should return top pairs sorted by count', async () => {
            mockPool.query.mockResolvedValueOnce({
                rows: [
                    { product_id_a: 15, product_id_b: 42, co_purchase_count: 12 },
                    { product_id_a: 37, product_id_b: 42, co_purchase_count: 8 }
                ]
            });

            const results = await repo.getTopPairs(1, 10);

            expect(results).toHaveLength(2);
            const query = mockPool.query.mock.calls[0][0];
            expect(query).toContain('ORDER BY co_purchase_count DESC');
        });
    });
});
