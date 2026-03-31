const request = require('supertest');
const createApp = require('../../src/app');

jest.mock('../../../../shared/auth-middleware', () => require('../__mocks__/auth-middleware'));

describe('Inventory API Integration', () => {
    let app, mockInventoryService, mockStockOutService;

    beforeEach(() => {
        mockInventoryService = {
            getInventorySummary: jest.fn(),
            receiveStock: jest.fn(),
            moveStockToShelf: jest.fn()
        };

        mockStockOutService = {
            getOrders: jest.fn(),
            getOrderById: jest.fn(),
            createOrder: jest.fn(),
            completeOrder: jest.fn()
        };

        app = createApp({ 
            inventoryService: mockInventoryService, 
            stockOutService: mockStockOutService 
        });
    });

    // === Inventory ===
    describe('GET /api/inventory/summary', () => {
        it('should return inventory summary', async () => {
            mockInventoryService.getInventorySummary.mockResolvedValue([{ product_id: 1, quantity: 10 }]);
            const res = await request(app).get('/api/inventory/summary').set('Authorization', 'Bearer token');
            expect(res.status).toBe(200);
            expect(res.body.data.summary).toHaveLength(1);
        });
    });

    describe('POST /api/inventory/receive', () => {
        it('should receive stock into inventory', async () => {
            mockInventoryService.receiveStock.mockResolvedValue();
            const res = await request(app).post('/api/inventory/receive')
                .set('Authorization', 'Bearer token')
                .send({ batchId: 1, locationId: 1, quantity: 10, reason: 'restock' });
            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Stock received into inventory successfully');
        });
    });

    describe('POST /api/inventory/move-to-shelf', () => {
        it('should move stock to shelf', async () => {
            mockInventoryService.moveStockToShelf.mockResolvedValue();
            const res = await request(app).post('/api/inventory/move-to-shelf')
                .set('Authorization', 'Bearer token')
                .send({ batchId: 1, locationId: 2, moveQty: 5 });
            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Stock moved to shelf successfully');
        });
    });

    // === Stock Out ===
    describe('GET /api/stock-out', () => {
        it('should return paginated stock-out orders', async () => {
            mockStockOutService.getOrders.mockResolvedValue({ items: [{ id: 1 }], total: 1 });
            const res = await request(app).get('/api/stock-out').set('Authorization', 'Bearer token');
            expect(res.status).toBe(200);
        });
    });

    describe('GET /api/stock-out/:id', () => {
        it('should return order details by ID', async () => {
            mockStockOutService.getOrderById.mockResolvedValue({ id: 1, status: 'completed' });
            const res = await request(app).get('/api/stock-out/1').set('Authorization', 'Bearer token');
            expect(res.status).toBe(200);
            expect(res.body.data.order.status).toBe('completed');
        });
    });

    describe('POST /api/stock-out', () => {
        it('should create stock out order', async () => {
            mockStockOutService.createOrder.mockResolvedValue({ id: 1, status: 'draft' });
            const res = await request(app).post('/api/stock-out')
                .set('Authorization', 'Bearer token')
                .send({ reason: 'sale', destination: 'Shop', items: [] });
            expect(res.status).toBe(201);
        });
    });

    describe('POST /api/stock-out/:id/complete', () => {
        it('should complete stock out order', async () => {
            mockStockOutService.completeOrder.mockResolvedValue({ message: 'Stock Out Order completed successfully' });
            const res = await request(app).post('/api/stock-out/1/complete')
                .set('Authorization', 'Bearer token');
            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Stock Out Order completed successfully');
        });
    });
});
