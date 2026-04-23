const express = require('express');
const axios = require('axios');
const { verifyToken } = require('../../../../shared/auth-middleware');

function createInventoryRouter(inventoryService, inventoryRepo, { catalogServiceUrl }) {
    const router = express.Router();

    /**
     * GET /public/batches/:storeId/:productId — Customer-facing FEFO batch list
     * PUBLIC: No auth required. Returns only active batches with on-shelf stock.
     * Excludes sensitive fields: cost_price, notes, quantity_on_hand
     */
    router.get('/public/batches/:storeId/:productId', async (req, res, next) => {
        try {
            const storeId = parseInt(req.params.storeId);
            const productId = parseInt(req.params.productId);

            if (!storeId || !productId) {
                return res.status(400).json({
                    success: false,
                    error: 'storeId and productId are required'
                });
            }

            const batches = await inventoryRepo.getBatchesByProduct(storeId, productId);

            // Filter: only active batches with stock on shelf
            const publicBatches = batches
                .filter(b => b.status === 'active' && parseInt(b.total_on_shelf) > 0)
                .map(b => ({
                    id: b.id,
                    batchCode: `B-${b.id}`,
                    unitPrice: parseFloat(b.unit_price) || 0,
                    discountPercentage: parseFloat(b.discount_percentage) || 0,
                    mfgDate: b.mfg_date,
                    expiryDate: b.expiry_date,
                    quantityAvailable: parseInt(b.total_on_shelf) || 0,
                    promotionApplied: b.promotion_applied || 'none'
                }));

            const totalOnShelf = publicBatches.reduce((sum, b) => sum + b.quantityAvailable, 0);

            res.json({
                success: true,
                data: {
                    storeId,
                    productId,
                    totalOnShelf,
                    batches: publicBatches
                }
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /summary — Product-level inventory summary with catalog product info
     * Returns camelCase formatted data for frontend consumption
     */
    router.get('/summary', verifyToken, async (req, res, next) => {
        try {
            const storeId = req.user ? req.user.storeId : 1;
            const filters = { productId: req.query.productId };
            
            // 1. Get inventory summary from DB view
            const summary = await inventoryService.getInventorySummary(storeId, filters);

            // 2. Fetch product info from Catalog service
            let productsMap = {};
            try {
                const authToken = req.headers.authorization?.replace('Bearer ', '');
                const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};
                const catalogResponse = await axios.get(
                    `${catalogServiceUrl}/api/products`,
                    { headers }
                );
                if (catalogResponse.data?.success && catalogResponse.data?.data?.products) {
                    catalogResponse.data.data.products.forEach(p => {
                        productsMap[p.id] = p;
                    });
                }
            } catch (err) {
                console.error('Failed to fetch products from catalog:', err.message);
                // Continue without product info — will show product_id only
            }

            // 3. Format and merge
            const formatted = summary.map(row => {
                const product = productsMap[row.product_id] || null;
                return {
                    id: row.product_id,
                    productId: row.product_id,
                    product: product ? {
                        id: product.id,
                        name: product.name,
                        productCode: product.product_code || product.productCode || null,
                        image: product.image || null,
                        unitPrice: product.unit_price || product.unitPrice || 0
                    } : {
                        id: row.product_id,
                        name: `Product #${row.product_id}`,
                        productCode: null
                    },
                    quantityOnHand: parseInt(row.total_on_hand) || 0,
                    quantityOnShelf: parseInt(row.total_on_shelf) || 0,
                    quantityReserved: parseInt(row.total_reserved) || 0,
                    quantityAvailable: parseInt(row.total_available) || 0,
                    reorderPoint: parseInt(row.reorder_point) || 10
                };
            });

            res.json({
                success: true,
                data: formatted
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * POST /receive — Receive stock into inventory
     */
    router.post('/receive', verifyToken, async (req, res, next) => {
        try {
            const storeId = req.user ? req.user.storeId : 1;
            const userId = req.user ? req.user.id : 1;
            
            const { batchId, locationId, quantity, reason } = req.body;
            
            await inventoryService.receiveStock(storeId, batchId, locationId, quantity, userId, reason);
            res.status(200).json({
                success: true,
                message: 'Stock received into inventory successfully'
            });
        } catch (error) {
            next(error);
        }
    });
    
    /**
     * POST /move-to-shelf — Transfer from On-Hand to On-Shelf
     */
    router.post('/move-to-shelf', verifyToken, async (req, res, next) => {
        try {
            const storeId = req.user ? req.user.storeId : 1;
            const userId = req.user ? req.user.id : 1;
            
            const { batchId, locationId, moveQty } = req.body;
            
            await inventoryService.moveStockToShelf(storeId, batchId, locationId, moveQty, userId);
            res.status(200).json({
                success: true,
                message: 'Stock moved to shelf successfully'
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * POST /adjust — Manual stock adjustment (increase/decrease)
     */
    router.post('/adjust', verifyToken, async (req, res, next) => {
        try {
            const storeId = req.user ? req.user.storeId : 1;
            const userId = req.user ? req.user.id : 1;

            const { batchId, locationId, quantity, targetLocation, reason } = req.body;

            if (!batchId || quantity === undefined) {
                return res.status(400).json({
                    success: false,
                    error: 'batchId and quantity are required'
                });
            }

            await inventoryService.adjustStock(
                storeId, batchId, locationId || null, quantity,
                targetLocation || 'onHand', userId, reason || 'manual_adjustment'
            );
            res.status(200).json({
                success: true,
                message: 'Stock adjusted successfully'
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /movements/:productId — Movement history for a product
     */
    router.get('/movements/:productId', verifyToken, async (req, res, next) => {
        try {
            const storeId = req.user ? req.user.storeId : 1;
            const productId = parseInt(req.params.productId);
            const limit = parseInt(req.query.limit) || 50;

            const movements = await inventoryRepo.getMovementsByProduct(storeId, productId, limit);

            // Format to camelCase
            const formatted = movements.map(m => ({
                id: m.id,
                batchId: m.product_batch_id,
                locationId: m.location_id,
                productId: m.product_id,
                movementType: m.movement_type,
                quantity: m.quantity,
                reason: m.reason,
                movedAt: m.moved_at,
                performedBy: m.performed_by
            }));

            res.json({
                success: true,
                data: formatted
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /batches/:productId — All batches for a product
     */
    router.get('/batches/:productId', verifyToken, async (req, res, next) => {
        try {
            const storeId = req.user ? req.user.storeId : 1;
            const productId = parseInt(req.params.productId);

            const batches = await inventoryRepo.getBatchesByProduct(storeId, productId);

            const formatted = batches.map(b => ({
                id: b.id,
                productId: b.product_id,
                costPrice: parseFloat(b.cost_price) || 0,
                unitPrice: parseFloat(b.unit_price) || 0,
                quantity: b.quantity,
                mfgDate: b.mfg_date,
                expiryDate: b.expiry_date,
                status: b.status,
                notes: b.notes,
                totalOnHand: parseInt(b.total_on_hand) || 0,
                totalOnShelf: parseInt(b.total_on_shelf) || 0
            }));

            res.json({
                success: true,
                data: formatted
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * PUT /reorder-point — Update reorder point for a product
     */
    router.put('/reorder-point', verifyToken, async (req, res, next) => {
        try {
            const storeId = req.user ? req.user.storeId : 1;
            const { productId, reorderPoint } = req.body;

            const config = await inventoryRepo.upsertReorderPoint(storeId, productId, reorderPoint);
            res.json({
                success: true,
                data: config
            });
        } catch (error) {
            next(error);
        }
    });

    // --- Saga Reserve Endpoints ---

    /**
     * POST /reserve — Reserve stock on shelf for an order
     * Body: { items: [{ batchId, locationId, quantity }], reason }
     */
    router.post('/reserve', verifyToken, async (req, res, next) => {
        try {
            const storeId = req.user ? req.user.storeId : 1;
            const { items, reason } = req.body;
            const result = await inventoryService.reserveStock(storeId, items, reason);
            res.json({ success: true, data: result });
        } catch (error) {
            next(error);
        }
    });

    /**
     * POST /release — Release reserved stock back to shelf (compensating)
     * Body: { items: [{ batchId, locationId, quantity }], reason }
     */
    router.post('/release', verifyToken, async (req, res, next) => {
        try {
            const storeId = req.user ? req.user.storeId : 1;
            const { items, reason } = req.body;
            const result = await inventoryService.releaseStock(storeId, items, reason);
            res.json({ success: true, data: result });
        } catch (error) {
            next(error);
        }
    });

    /**
     * POST /confirm-deduct — Confirm deduction of reserved stock (final)
     * Body: { items: [{ batchId, locationId, quantity }], reason }
     */
    router.post('/confirm-deduct', verifyToken, async (req, res, next) => {
        try {
            const storeId = req.user ? req.user.storeId : 1;
            const { items, reason } = req.body;
            const result = await inventoryService.confirmDeduct(storeId, items, reason);
            res.json({ success: true, data: result });
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /items/:productId — All inventory items for a product (Detail Inventories page)
     * Returns batch-level item data from PostgreSQL (replaces old MongoDB detail-inventories)
     */
    router.get('/items/:productId', verifyToken, async (req, res, next) => {
        try {
            const storeId = req.user ? req.user.storeId : 1;
            const productId = parseInt(req.params.productId);

            const items = await inventoryRepo.getInventoryItemsByProduct(storeId, productId);

            const formatted = items.map(row => ({
                id: row.id,
                batchId: {
                    id: row.product_batch_id,
                    batchCode: `B-${row.product_batch_id}`,
                    productId: row.product_id,
                    costPrice: parseFloat(row.cost_price) || 0,
                    unitPrice: parseFloat(row.unit_price) || 0,
                    quantity: row.batch_quantity,
                    mfgDate: row.mfg_date,
                    expiryDate: row.expiry_date,
                    status: row.batch_status,
                    notes: row.batch_notes
                },
                locationId: row.location_id,
                location: row.loc_name || null,
                quantityOnHand: row.quantity_on_hand || 0,
                quantityOnShelf: row.quantity_on_shelf || 0,
                quantityReserved: row.quantity_reserved || 0,
                quantityAvailable: (row.quantity_on_hand || 0) + (row.quantity_on_shelf || 0) - (row.quantity_reserved || 0),
                reorderPoint: row.reorder_point || 10
            }));

            res.json({
                success: true,
                data: { detailInventories: formatted }
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /items/:itemId/movements — Movement history for a specific inventory item
     */
    router.get('/items/:itemId/movements', verifyToken, async (req, res, next) => {
        try {
            const itemId = parseInt(req.params.itemId);
            const limit = parseInt(req.query.limit) || 50;

            const movements = await inventoryRepo.getMovementsByItem(itemId, limit);

            const formatted = movements.map(m => ({
                id: m.id,
                inventoryItemId: m.inventory_item_id,
                movementType: m.movement_type,
                quantity: m.quantity,
                reason: m.reason,
                movedAt: m.moved_at,
                performedBy: m.performed_by
            }));

            res.json({
                success: true,
                data: formatted
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * POST /return-stock — Return items to warehouse (manual refund return)
     * Body: { items: [{ batchId, locationId, quantity }], reason }
     */
    router.post('/return-stock', verifyToken, async (req, res, next) => {
        try {
            const storeId = req.user ? req.user.storeId : 1;
            const { items, reason } = req.body;

            if (!items || !Array.isArray(items) || items.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: { message: 'items array is required' }
                });
            }

            const result = await inventoryService.returnStock(storeId, items, reason || 'manual_refund_return');
            res.json({ success: true, data: result });
        } catch (error) {
            next(error);
        }
    });

    return router;
}

module.exports = createInventoryRouter;
