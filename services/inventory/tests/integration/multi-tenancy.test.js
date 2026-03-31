const InventoryService = require('../../src/services/inventory.service');
const { NotFoundError } = require('../../../../shared/common/errors');

describe('Inventory Multi-Tenancy Isolation', () => {
    let mockInventoryRepo;
    let mockBatchRepo;
    let mockWarehouseRepo;
    let mockPool;
    let inventoryService;

    beforeEach(() => {
        mockInventoryRepo = {};
        mockBatchRepo = {
            findById: jest.fn()
        };
        mockWarehouseRepo = {};
        mockPool = {
            connect: jest.fn().mockResolvedValue({
                query: jest.fn(),
                release: jest.fn()
            })
        };
        
        inventoryService = new InventoryService(mockInventoryRepo, mockBatchRepo, mockWarehouseRepo, mockPool);
    });

    it('should reject access and throw NotFoundError when Store B attempts to receive stock for Store A\'s batch', async () => {
        // Assume Batch 500 belongs to Store A (store_id = 1)
        const attackerStoreId = 2; // Store B
        const targetBatchId = 500; // Store A's batch
        
        // Mock repository behavior matching our SQL Row-Level isolation: 
        // `SELECT * FROM product_batch WHERE id = $1 AND store_id = $2`
        // If the storeId does not match the actual batch's storeId, it returns null
        mockBatchRepo.findById.mockImplementation((storeId, id) => {
            if (storeId === 1 && id === targetBatchId) {
                return Promise.resolve({ id: targetBatchId, store_id: 1, status: 'active' });
            }
            return Promise.resolve(null); // DB level multi-tenancy filter
        });

        // The Service must throw NotFoundError when repo returns null
        await expect(inventoryService.receiveStock(attackerStoreId, targetBatchId, 1, 50, 99))
            .rejects.toThrow(NotFoundError);
            
        // Verify the repository was explicitly queried with the attacker's storeId
        expect(mockBatchRepo.findById).toHaveBeenCalledWith(attackerStoreId, targetBatchId);
    });

    it('should allow batch retrieval when the correct Store receives its own stock', async () => {
        const ownerStoreId = 1;
        const targetBatchId = 500;
        
        mockBatchRepo.findById.mockImplementation((storeId, id) => {
            if (storeId === 1 && id === targetBatchId) {
                return Promise.resolve({ id: targetBatchId, store_id: 1, status: 'active' });
            }
            return Promise.resolve(null);
        });
        
        // Let's force an error downstream to confirm the first authorization check passed
        mockInventoryRepo.findItemForUpdateWithClient = jest.fn().mockRejectedValue(new Error('Downstream'));
        mockPool.connect = jest.fn().mockResolvedValue({ query: jest.fn(), release: jest.fn() });

        await expect(inventoryService.receiveStock(ownerStoreId, targetBatchId, 1, 50, 99))
            .rejects.toThrow('Downstream');

        expect(mockBatchRepo.findById).toHaveBeenCalledWith(ownerStoreId, targetBatchId);
    });
});
