const ProductService = require('../../src/services/product.service');
const { ValidationError, AppError } = require('../../../../shared/common/errors');

describe('Product Service Unit Tests', () => {
    let mockProductRepo;
    let mockCategoryRepo;
    let mockPriceHistoryRepo;
    let mockPool;
    let mockClient;
    let productService;

    beforeEach(() => {
        mockProductRepo = {
            updatePriceWithClient: jest.fn()
        };
        mockCategoryRepo = {
             findById: jest.fn().mockResolvedValue({ id: 1, name: 'Food' }) // default mock
        };
        mockPriceHistoryRepo = {
            createWithClient: jest.fn()
        };
        
        mockClient = {
            query: jest.fn(),
            release: jest.fn()
        };
        
        mockPool = {
            connect: jest.fn().mockResolvedValue(mockClient)
        };

        // Override getProductById to test updatePrice internally
        productService = new ProductService(
            mockProductRepo, mockCategoryRepo, mockPriceHistoryRepo, mockPool
        );
        productService.getProductById = jest.fn();
    });

    describe('updatePrice (TRANSACTION ZONE 1)', () => {
        it('should execute transaction successfully and record history', async () => {
            // Setup
            const productId = 1;
            const newPrice = 150000;
            const reason = 'Inflation';
            const userId = 99;
            
            productService.getProductById.mockResolvedValue({ id: 1, unit_price: 100000 });
            mockProductRepo.updatePriceWithClient.mockResolvedValue({ id: 1, unit_price: 150000 });

            // Exec
            const result = await productService.updatePrice(productId, newPrice, reason, userId);

            // Assert
            expect(result.unit_price).toBe(150000);
            
            // Transaction flow checks
            expect(mockPool.connect).toHaveBeenCalled();
            expect(mockClient.query).toHaveBeenNthCalledWith(1, 'BEGIN');
            
            // Repositories called with client
            expect(mockProductRepo.updatePriceWithClient).toHaveBeenCalledWith(mockClient, 1, 150000);
            expect(mockPriceHistoryRepo.createWithClient).toHaveBeenCalledWith(mockClient, {
                product_id: 1,
                old_price: 100000,
                new_price: 150000,
                reason: reason,
                changed_by: userId
            });

            expect(mockClient.query).toHaveBeenNthCalledWith(2, 'COMMIT');
            expect(mockClient.release).toHaveBeenCalled();
        });

        it('should rollback if history logging throws error', async () => {
            // Setup
            productService.getProductById.mockResolvedValue({ id: 1, unit_price: 100000 });
            mockProductRepo.updatePriceWithClient.mockResolvedValue({ id: 1, unit_price: 150000 });
            
            // Force error on step 2
            mockPriceHistoryRepo.createWithClient.mockRejectedValue(new Error('DB crash'));

            // Exec & Assert
            await expect(productService.updatePrice(1, 150000, 'Reason', 99))
                .rejects
                .toThrow(AppError);

            expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
            expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
            expect(mockClient.query).not.toHaveBeenCalledWith('COMMIT');
            expect(mockClient.release).toHaveBeenCalled();
        });

        it('should prevent updating to same price', async () => {
            productService.getProductById.mockResolvedValue({ id: 1, unit_price: 100000 });

            await expect(productService.updatePrice(1, 100000, 'Reason', 99))
                .rejects
                .toThrow(ValidationError);
                
            expect(mockPool.connect).not.toHaveBeenCalled();
        });
    });
});
