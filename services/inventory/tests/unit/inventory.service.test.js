const InventoryService = require('../../src/services/inventory.service');
const { ValidationError, NotFoundError, AppError } = require('../../../../shared/common/errors');

describe('Inventory Service Unit Tests', () => {
    let mockInventoryRepo;
    let mockBatchRepo;
    let mockWarehouseRepo;
    let mockPool;
    let mockClient;
    let inventoryService;

    beforeEach(() => {
        mockInventoryRepo = {
            findItemForUpdateWithClient: jest.fn(),
            createItemWithClient: jest.fn(),
            updateItemQuantitiesWithClient: jest.fn(),
            recordMovementWithClient: jest.fn()
        };
        mockBatchRepo = {
            findById: jest.fn()
        };
        mockWarehouseRepo = {};
        
        mockClient = {
            query: jest.fn().mockResolvedValue({ rows: [{ id: 1 }] }), // For location check mock
            release: jest.fn()
        };
        mockPool = {
            connect: jest.fn().mockResolvedValue(mockClient)
        };

        inventoryService = new InventoryService(mockInventoryRepo, mockBatchRepo, mockWarehouseRepo, mockPool);
    });

    describe('receiveStock (TRANSACTION ZONE 1)', () => {
        const storeId = 100;
        const batchId = 1;
        const locationId = 10;
        const quantity = 50;
        const userId = 99;

        it('should receive stock into new inventory item successfully', async () => {
            // Setup
            mockBatchRepo.findById.mockResolvedValue({ id: batchId, status: 'active', store_id: storeId });
            mockInventoryRepo.findItemForUpdateWithClient.mockResolvedValue(null); // Item not exist
            mockInventoryRepo.createItemWithClient.mockResolvedValue({ id: 999 }); // New item created

            // Exec
            const result = await inventoryService.receiveStock(storeId, batchId, locationId, quantity, userId);

            // Assert
            expect(result.message).toBe('Stock received successfully');
            expect(mockPool.connect).toHaveBeenCalled();
            expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
            
            // Check cross-tenant rule
            expect(mockBatchRepo.findById).toHaveBeenCalledWith(storeId, batchId);

            // Verify operations
            expect(mockInventoryRepo.createItemWithClient).toHaveBeenCalled();
            expect(mockInventoryRepo.updateItemQuantitiesWithClient).toHaveBeenCalledWith(mockClient, 999, quantity, 0, 0);
            expect(mockInventoryRepo.recordMovementWithClient).toHaveBeenCalledWith(mockClient, {
                inventory_item_id: 999,
                movement_type: 'in',
                quantity: quantity,
                reason: 'po_receive',
                performed_by: userId
            });

            expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
            expect(mockClient.release).toHaveBeenCalled();
        });

        it('should throw Error if receive quantity <= 0', async () => {
            await expect(inventoryService.receiveStock(storeId, batchId, locationId, 0, userId))
                .rejects.toThrow(ValidationError);
                
            expect(mockPool.connect).not.toHaveBeenCalled();
        });

        it('should rollback transaction on error', async () => {
             // Mock error on update step
             mockBatchRepo.findById.mockResolvedValue({ id: batchId, status: 'active' });
             mockInventoryRepo.findItemForUpdateWithClient.mockResolvedValue({ id: 888 });
             mockInventoryRepo.updateItemQuantitiesWithClient.mockRejectedValue(new Error('DB Crash'));

             // Exec & Assert
             await expect(inventoryService.receiveStock(storeId, batchId, locationId, quantity, userId))
                 .rejects.toThrow('DB Crash');

             expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
             expect(mockClient.query).not.toHaveBeenCalledWith('COMMIT');
             expect(mockClient.release).toHaveBeenCalled();
        });
        
        it('should block insert if batch does not belong to store', async () => {
            mockBatchRepo.findById.mockResolvedValue(null); // Repo filter by store returned null
            
            await expect(inventoryService.receiveStock(storeId, batchId, locationId, quantity, userId))
                .rejects.toThrow(NotFoundError);
                
            expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
        });
    });

    describe('deductStock (POS Checkout SAGA)', () => {
        const storeId = 100;
        const batchId = 1;
        const locationId = 10;
        const quantity = 5;
        const userId = 99;

        it('should deduct stock from on_shelf successfully', async () => {
            mockBatchRepo.findById.mockResolvedValue({ id: batchId, status: 'active', store_id: storeId });
            mockInventoryRepo.findItemForUpdateWithClient.mockResolvedValue({ 
                id: 888, quantity_on_shelf: 20, quantity_on_hand: 10 
            });

            const result = await inventoryService.deductStock(storeId, batchId, locationId, quantity, userId);

            expect(result.message).toBe('Stock deducted successfully');
            expect(mockClient.query).toHaveBeenCalledWith('BEGIN');

            // Verify on_shelf decreased
            expect(mockInventoryRepo.updateItemQuantitiesWithClient).toHaveBeenCalledWith(
                mockClient, 888, 0, -quantity, 0
            );

            // Verify movement log
            expect(mockInventoryRepo.recordMovementWithClient).toHaveBeenCalledWith(mockClient, {
                inventory_item_id: 888,
                movement_type: 'out',
                quantity: quantity,
                reason: 'pos_sale',
                performed_by: userId
            });

            expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
            expect(mockClient.release).toHaveBeenCalled();
        });

        it('should throw ValidationError if quantity <= 0', async () => {
            await expect(inventoryService.deductStock(storeId, batchId, locationId, 0, userId))
                .rejects.toThrow(ValidationError);
            await expect(inventoryService.deductStock(storeId, batchId, locationId, -1, userId))
                .rejects.toThrow(ValidationError);

            expect(mockPool.connect).not.toHaveBeenCalled();
        });

        it('should throw NotFoundError if batch not in store', async () => {
            mockBatchRepo.findById.mockResolvedValue(null);

            await expect(inventoryService.deductStock(storeId, batchId, locationId, quantity, userId))
                .rejects.toThrow(NotFoundError);

            expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
        });

        it('should throw ValidationError if insufficient on_shelf stock', async () => {
            mockBatchRepo.findById.mockResolvedValue({ id: batchId, status: 'active' });
            mockInventoryRepo.findItemForUpdateWithClient.mockResolvedValue({ 
                id: 888, quantity_on_shelf: 3, quantity_on_hand: 10 
            });

            await expect(inventoryService.deductStock(storeId, batchId, locationId, quantity, userId))
                .rejects.toThrow(ValidationError);

            expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
            expect(mockInventoryRepo.updateItemQuantitiesWithClient).not.toHaveBeenCalled();
        });

        it('should rollback on unexpected error', async () => {
            mockBatchRepo.findById.mockResolvedValue({ id: batchId, status: 'active' });
            mockInventoryRepo.findItemForUpdateWithClient.mockResolvedValue({ 
                id: 888, quantity_on_shelf: 20 
            });
            mockInventoryRepo.updateItemQuantitiesWithClient.mockRejectedValue(new Error('DB crash'));

            await expect(inventoryService.deductStock(storeId, batchId, locationId, quantity, userId))
                .rejects.toThrow('DB crash');

            expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
            expect(mockClient.release).toHaveBeenCalled();
        });

        it('should use custom reason when provided', async () => {
            mockBatchRepo.findById.mockResolvedValue({ id: batchId, status: 'active' });
            mockInventoryRepo.findItemForUpdateWithClient.mockResolvedValue({ 
                id: 888, quantity_on_shelf: 20 
            });

            await inventoryService.deductStock(storeId, batchId, locationId, quantity, userId, 'pos_sale_order_123');

            expect(mockInventoryRepo.recordMovementWithClient).toHaveBeenCalledWith(mockClient,
                expect.objectContaining({ reason: 'pos_sale_order_123' })
            );
        });
    });
});
