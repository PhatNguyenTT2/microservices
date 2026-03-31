const ApiClient = require('../../src/services/api.client');

// Mock global fetch
global.fetch = jest.fn();

describe('ApiClient Unit Tests', () => {
    let apiClient;

    beforeEach(() => {
        apiClient = new ApiClient('test-token');
        global.fetch.mockReset();
    });

    describe('searchProducts', () => {
        it('should call Catalog API with search query', async () => {
            global.fetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    status: 'success',
                    data: { products: [{ id: 1, name: 'Coca Cola' }] }
                })
            });

            const result = await apiClient.searchProducts('Coca');

            expect(result.success).toBe(true);
            expect(result.data.products).toHaveLength(1);
            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/api/products?search=Coca'),
                expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) })
            );
        });

        it('should handle API error gracefully', async () => {
            global.fetch.mockResolvedValue({
                ok: false,
                status: 500,
                json: () => Promise.resolve({ error: 'Internal error' })
            });

            const result = await apiClient.searchProducts('test');

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
        });

        it('should handle network failure', async () => {
            global.fetch.mockRejectedValue(new Error('ECONNREFUSED'));

            const result = await apiClient.searchProducts('test');

            expect(result.success).toBe(false);
            expect(result.error).toBe('ECONNREFUSED');
        });
    });

    describe('getInventorySummary', () => {
        it('should call Inventory API', async () => {
            global.fetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    status: 'success',
                    data: { summary: [{ quantity_on_hand: 10, quantity_on_shelf: 5 }] }
                })
            });

            const result = await apiClient.getInventorySummary(1, 5);

            expect(result.success).toBe(true);
            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/api/inventory/summary?productId=5'),
                expect.any(Object)
            );
        });
    });

    describe('getOrderById', () => {
        it('should fetch single order', async () => {
            global.fetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    status: 'success',
                    data: { order: { id: 123, status: 'completed' } }
                })
            });

            const result = await apiClient.getOrderById(123);

            expect(result.success).toBe(true);
            expect(result.data.order.id).toBe(123);
        });
    });

    describe('getOrders', () => {
        it('should fetch orders with filters', async () => {
            global.fetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    status: 'success',
                    data: { orders: [{ id: 1, status: 'draft' }] }
                })
            });

            const result = await apiClient.getOrders({ status: 'draft' });

            expect(result.success).toBe(true);
            expect(global.fetch).toHaveBeenCalledWith(
                expect.stringContaining('status=draft'),
                expect.any(Object)
            );
        });
    });

    describe('no auth token', () => {
        it('should work without token', async () => {
            const noAuthClient = new ApiClient();
            global.fetch.mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ status: 'success', data: {} })
            });

            await noAuthClient.searchProducts('test');

            const headers = global.fetch.mock.calls[0][1].headers;
            expect(headers.Authorization).toBeUndefined();
        });
    });
});
