const CategoryService = require('../../src/services/category.service');
const { ValidationError, NotFoundError } = require('../../../../shared/common/errors');

describe('Category Service Unit Tests', () => {
    let mockCategoryRepo;
    let mockProductRepo;
    let categoryService;

    beforeEach(() => {
        mockCategoryRepo = {
            findAll: jest.fn(),
            findById: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn()
        };
        mockProductRepo = {
            findAll: jest.fn()
        };

        categoryService = new CategoryService(mockCategoryRepo, mockProductRepo);
    });

    describe('deleteCategory', () => {
        it('should delete if no products are linked', async () => {
            mockCategoryRepo.findById.mockResolvedValue({ id: 1, name: 'Food' });
            mockProductRepo.findAll.mockResolvedValue([]); // No products
            mockCategoryRepo.delete.mockResolvedValue(1);

            const result = await categoryService.deleteCategory(1);
            expect(result.message).toBe('Category deleted successfully');
            expect(mockCategoryRepo.delete).toHaveBeenCalledWith(1);
        });

        it('should throw ValidationError if products exist in category', async () => {
            mockCategoryRepo.findById.mockResolvedValue({ id: 1, name: 'Food' });
            mockProductRepo.findAll.mockResolvedValue([{ id: 101, name: 'Apple' }]); // Has products

            await expect(categoryService.deleteCategory(1))
                .rejects
                .toThrow(ValidationError);
            
            expect(mockCategoryRepo.delete).not.toHaveBeenCalled();
        });

        it('should throw NotFoundError if category does not exist', async () => {
            mockCategoryRepo.findById.mockResolvedValue(null);

            await expect(categoryService.deleteCategory(999))
                .rejects
                .toThrow(NotFoundError);
        });
    });
});
