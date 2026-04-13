const express = require('express');
const { verifyToken } = require('../../../../shared/auth-middleware');

function createCategoryRouter(categoryService) {
    const router = express.Router();

    // GET all categories (flat list, with optional filters)
    router.get('/', verifyToken, async (req, res, next) => {
        try {
            const filters = {
                search: req.query.search,
                parentId: req.query.parentId
            };
            const categories = await categoryService.getAllCategories(filters);
            res.json({
                success: true,
                data: { categories }
            });
        } catch (error) {
            next(error);
        }
    });

    // GET category tree (nested: roots with children[])
    router.get('/tree', verifyToken, async (req, res, next) => {
        try {
            const tree = await categoryService.getCategoryTree();
            res.json({
                success: true,
                data: { categories: tree }
            });
        } catch (error) {
            next(error);
        }
    });

    // GET product IDs of perishable categories (for cross-service promotion)
    router.get('/perishable-products', verifyToken, async (req, res, next) => {
        try {
            const productIds = await categoryService.getPerishableProductIds();
            res.json({
                success: true,
                data: productIds
            });
        } catch (error) {
            next(error);
        }
    });

    // GET category by ID
    router.get('/:id', verifyToken, async (req, res, next) => {
        try {
            const category = await categoryService.getCategoryById(req.params.id);
            res.json({
                success: true,
                data: { category }
            });
        } catch (error) {
            next(error);
        }
    });

    // GET subcategories of a parent
    router.get('/:id/subcategories', verifyToken, async (req, res, next) => {
        try {
            const subcategories = await categoryService.getSubcategories(req.params.id);
            res.json({
                success: true,
                data: { subcategories }
            });
        } catch (error) {
            next(error);
        }
    });

    // CREATE category
    router.post('/', verifyToken, async (req, res, next) => {
        try {
            const category = await categoryService.createCategory(req.body);
            res.status(201).json({
                success: true,
                message: 'Category created successfully',
                data: { category }
            });
        } catch (error) {
            next(error);
        }
    });

    // UPDATE category
    router.put('/:id', verifyToken, async (req, res, next) => {
        try {
            const category = await categoryService.updateCategory(req.params.id, req.body);
            res.json({
                success: true,
                message: 'Category updated successfully',
                data: { category }
            });
        } catch (error) {
            next(error);
        }
    });

    // DELETE category
    router.delete('/:id', verifyToken, async (req, res, next) => {
        try {
            const result = await categoryService.deleteCategory(req.params.id);
            res.json({
                success: true,
                message: result.message
            });
        } catch (error) {
            next(error);
        }
    });

    return router;
}

module.exports = createCategoryRouter;
