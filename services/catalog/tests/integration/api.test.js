const request = require('supertest');
const createApp = require('../../src/app');

// Mock dependencies
jest.mock('../../../../shared/auth-middleware', () => require('../__mocks__/auth-middleware'));

describe('Catalog API Integration', () => {
    let app, mockCategoryService, mockProductService;

    beforeEach(() => {
        mockCategoryService = {
            getAllCategories: jest.fn(),
            getCategoryById: jest.fn(),
            createCategory: jest.fn(),
            updateCategory: jest.fn(),
            deleteCategory: jest.fn(),
        };

        mockProductService = {
            getProducts: jest.fn(),
            getProductById: jest.fn(),
            createProduct: jest.fn(),
            updateStatus: jest.fn(),
            updatePrice: jest.fn(),
            getPriceHistory: jest.fn(),
        };

        app = createApp({ 
            categoryService: mockCategoryService, 
            productService: mockProductService 
        });
    });

    // === Categories ===
    describe('GET /api/categories', () => {
        it('should return all categories', async () => {
            mockCategoryService.getAllCategories.mockResolvedValue([{ id: 1, name: 'Beverages' }]);
            const res = await request(app).get('/api/categories').set('Authorization', 'Bearer token');
            expect(res.status).toBe(200);
            expect(res.body.data.categories).toHaveLength(1);
        });
    });

    describe('POST /api/categories', () => {
        it('should create a category', async () => {
            mockCategoryService.createCategory.mockResolvedValue({ id: 1, name: 'Snacks' });
            const res = await request(app).post('/api/categories')
                .set('Authorization', 'Bearer token')
                .send({ name: 'Snacks', description: 'desc' });
            expect(res.status).toBe(201);
            expect(res.body.data.category.name).toBe('Snacks');
        });
    });

    describe('PUT /api/categories/:id', () => {
        it('should update a category', async () => {
            mockCategoryService.updateCategory.mockResolvedValue({ id: 1, name: 'Updated' });
            const res = await request(app).put('/api/categories/1')
                .set('Authorization', 'Bearer token')
                .send({ name: 'Updated' });
            expect(res.status).toBe(200);
        });
    });

    describe('DELETE /api/categories/:id', () => {
        it('should delete a category', async () => {
            mockCategoryService.deleteCategory.mockResolvedValue({ message: 'Deleted' });
            const res = await request(app).delete('/api/categories/1').set('Authorization', 'Bearer token');
            expect(res.status).toBe(200);
            expect(res.body.message).toBe('Deleted');
        });
    });

    // === Products ===
    describe('GET /api/products', () => {
        it('should return paginated products', async () => {
            mockProductService.getProducts.mockResolvedValue({ items: [{ id: 1 }], total: 1 });
            const res = await request(app).get('/api/products').set('Authorization', 'Bearer token');
            expect(res.status).toBe(200);
        });
    });

    describe('POST /api/products', () => {
        it('should create a product', async () => {
            mockProductService.createProduct.mockResolvedValue({ id: 1, name: 'Coke' });
            const res = await request(app).post('/api/products')
                .set('Authorization', 'Bearer token')
                .send({ name: 'Coke', category_id: 1, base_price: 10, barcode: '123' });
            expect(res.status).toBe(201);
        });
    });

    describe('PUT /api/products/:id/status', () => {
        it('should update product status', async () => {
            mockProductService.updateStatus.mockResolvedValue({ id: 1, is_active: false });
            const res = await request(app).put('/api/products/1/status')
                .set('Authorization', 'Bearer token')
                .send({ isActive: false });
            expect(res.status).toBe(200);
        });
        
        it('should return 400 if isActive is missing', async () => {
            const res = await request(app).put('/api/products/1/status')
                .set('Authorization', 'Bearer token')
                .send({});
            // 400 since error handler returns 400 for ValidationError
            expect(res.status).toBe(400); 
        });
    });

    describe('POST /api/products/:id/price-change', () => {
        it('should update product price', async () => {
            mockProductService.updatePrice.mockResolvedValue({ id: 1, base_price: 15 });
            const res = await request(app).post('/api/products/1/price-change')
                .set('Authorization', 'Bearer token')
                .send({ newPrice: 15, reason: 'inflation' });
            expect(res.status).toBe(200);
        });
    });

    describe('GET /api/products/:id/price-history', () => {
        it('should return price history', async () => {
            mockProductService.getPriceHistory.mockResolvedValue([{ id: 1, old_price: 10, new_price: 15 }]);
            const res = await request(app).get('/api/products/1/price-history')
                .set('Authorization', 'Bearer token');
            expect(res.status).toBe(200);
        });
    });
});
