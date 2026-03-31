const OrderService = require('../../src/services/order.service');
const { NotFoundError } = require('../../../../shared/common/errors');

describe('Order Multi-Tenancy Isolation', () => {
    let mockOrderRepo;
    let mockDetailRepo;
    let mockPool;
    let orderService;

    beforeEach(() => {
        mockOrderRepo = {
            findById: jest.fn()
        };
        mockDetailRepo = {
            findByOrderId: jest.fn().mockResolvedValue([])
        };
        mockPool = {};
        
        orderService = new OrderService(mockOrderRepo, mockDetailRepo, mockPool);
    });

    it('should reject access and throw NotFoundError when Store B attempts to read Store A\'s order', async () => {
        // Assume Order 100 belongs to Store A (store_id = 1)
        const attackerStoreId = 2; // Store B
        const targetOrderId = 100; // Store A's order
        
        // Mock repository behavior matching our SQL Row-Level isolation: 
        // `SELECT * FROM Orders WHERE id = $1 AND store_id = $2`
        // If the storeId does not match the actual order's storeId, it returns null
        mockOrderRepo.findById.mockImplementation((storeId, id) => {
            if (storeId === 1 && id === targetOrderId) {
                return Promise.resolve({ id: targetOrderId, store_id: 1 });
            }
            return Promise.resolve(null); // Isolation block at DB level
        });

        // The Service must throw NotFoundError when repo returns null
        await expect(orderService.getOrderById(attackerStoreId, targetOrderId))
            .rejects.toThrow(NotFoundError);
            
        // Verify the repository was explicitly queried with the attacker's storeId
        expect(mockOrderRepo.findById).toHaveBeenCalledWith(attackerStoreId, targetOrderId);
    });

    it('should allow access when the correct Store queries its own order', async () => {
        const ownerStoreId = 1;
        const targetOrderId = 100;
        
        mockOrderRepo.findById.mockImplementation((storeId, id) => {
            if (storeId === 1 && id === targetOrderId) {
                return Promise.resolve({ id: targetOrderId, store_id: 1 });
            }
            return Promise.resolve(null);
        });

        const order = await orderService.getOrderById(ownerStoreId, targetOrderId);
        expect(order).toBeDefined();
        expect(order.store_id).toBe(ownerStoreId);
        expect(mockOrderRepo.findById).toHaveBeenCalledWith(ownerStoreId, targetOrderId);
    });
});
