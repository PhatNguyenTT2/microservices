const express = require('express');
const { ValidationError } = require('../../../../shared/common/errors');
const { verifyToken } = require('../../../../shared/auth-middleware');

function createProductRouter(productService) {
    const router = express.Router();

    // GET all products (with filters + pagination) — public read access
    router.get('/', async (req, res, next) => {
        try {
            const { categoryId, search, isActive, vendor, page, per_page, sort, order } = req.query;
            const filters = {
                categoryId: categoryId || undefined,
                search: search || undefined,
                isActive: isActive !== undefined ? isActive === 'true' : undefined,
                vendor: vendor || undefined,
                sort: sort || undefined,
                order: order || undefined
            };

            // Use paginated query if page/per_page provided
            if (page || per_page) {
                const pageNum = parseInt(page) || 1;
                const perPage = parseInt(per_page) || 20;
                const result = await productService.getProductsPaginated(filters, pageNum, perPage);
                res.json({
                    success: true,
                    data: result
                });
            } else {
                const products = await productService.getProducts(filters);
                res.json({
                    success: true,
                    data: { products }
                });
            }
        } catch (error) {
            next(error);
        }
    });

    // GET product by ID — public read access
    router.get('/:id', async (req, res, next) => {
        try {
            const product = await productService.getProductById(req.params.id);
            res.json({
                success: true,
                data: { product }
            });
        } catch (error) {
            next(error);
        }
    });

    // CREATE product
    router.post('/', verifyToken, async (req, res, next) => {
        try {
            const product = await productService.createProduct(req.body);
            res.status(201).json({
                success: true,
                message: 'Product created successfully',
                data: { product }
            });
        } catch (error) {
            next(error);
        }
    });

    // UPDATE product (general)
    router.put('/:id', verifyToken, async (req, res, next) => {
        try {
            const product = await productService.updateProduct(req.params.id, req.body);
            res.json({
                success: true,
                message: 'Product updated successfully',
                data: { product }
            });
        } catch (error) {
            next(error);
        }
    });

    // DELETE product
    router.delete('/:id', verifyToken, async (req, res, next) => {
        try {
            const result = await productService.deleteProduct(req.params.id);
            res.json({
                success: true,
                message: result.message
            });
        } catch (error) {
            next(error);
        }
    });

    // Toggle status
    router.put('/:id/status', verifyToken, async (req, res, next) => {
        try {
            const { isActive } = req.body;
            if (isActive === undefined) {
                throw new ValidationError('isActive flag is required');
            }
            
            const product = await productService.updateStatus(req.params.id, isActive);
            res.json({
                success: true,
                message: 'Product status updated',
                data: { product }
            });
        } catch (error) {
            next(error);
        }
    });

    // Price change (with history)
    router.post('/:id/price-change', verifyToken, async (req, res, next) => {
        try {
            const { newPrice, reason } = req.body;
            const changedByUserId = req.user ? req.user.id : 1; 
            
            const product = await productService.updatePrice(
                req.params.id, 
                newPrice, 
                reason, 
                changedByUserId
            );
            
            res.json({
                success: true,
                message: 'Product price updated successfully',
                data: { product }
            });
        } catch (error) {
            next(error);
        }
    });

    // Price history
    router.get('/:id/price-history', verifyToken, async (req, res, next) => {
        try {
            const history = await productService.getPriceHistory(req.params.id);
            res.json({
                success: true,
                data: { history }
            });
        } catch (error) {
            next(error);
        }
    });

    return router;
}

module.exports = createProductRouter;
