const express = require('express');
const { verifyToken } = require('../../../../shared/auth-middleware');

function createWarehouseRouter(warehouseService) {
    const router = express.Router();

    // ==========================================
    // BLOCK ENDPOINTS
    // ==========================================

    /**
     * GET /blocks — List all blocks for store (optional ?type=warehouse|store_shelf)
     */
    router.get('/blocks', verifyToken, async (req, res, next) => {
        try {
            const storeId = req.user?.storeId ?? 1;
            const filters = {};
            if (req.query.type) filters.type = req.query.type;

            const blocks = await warehouseService.getBlocks(storeId, filters);

            const formatted = blocks.map(b => ({
                id: b.id,
                storeId: b.store_id,
                name: b.name,
                type: b.type,
                rows: b.rows,
                cols: b.cols,
                columnGaps: b.column_gaps || [],
                locations: (b.locations || []).map(l => ({
                    id: l.id,
                    blockId: l.block_id,
                    name: l.name,
                    position: l.position,
                    maxCapacity: l.max_capacity,
                    isActive: l.is_active,
                    occupiedCapacity: parseInt(l.occupied_capacity) || 0,
                    inventoryItemCount: parseInt(l.inventory_item_count) || 0
                }))
            }));

            res.json({ success: true, data: formatted });
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /blocks/:id — Get single block with locations
     */
    router.get('/blocks/:id', verifyToken, async (req, res, next) => {
        try {
            const storeId = req.user?.storeId ?? 1;
            const blockId = parseInt(req.params.id);

            const block = await warehouseService.getBlockById(storeId, blockId);

            res.json({
                success: true,
                data: {
                    id: block.id,
                    storeId: block.store_id,
                    name: block.name,
                    type: block.type,
                    rows: block.rows,
                    cols: block.cols,
                    columnGaps: block.column_gaps || [],
                    locations: (block.locations || []).map(l => ({
                        id: l.id,
                        blockId: l.block_id,
                        name: l.name,
                        position: l.position,
                        maxCapacity: l.max_capacity,
                        isActive: l.is_active,
                        occupiedCapacity: parseInt(l.occupied_capacity) || 0,
                        inventoryItemCount: parseInt(l.inventory_item_count) || 0
                    }))
                }
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * POST /blocks — Create block with auto-generated locations
     * Body: { name, type, rows, cols, columnGaps }
     */
    router.post('/blocks', verifyToken, async (req, res, next) => {
        try {
            const storeId = req.user?.storeId ?? 1;
            const { name, type, rows, cols, columnGaps } = req.body;

            const result = await warehouseService.createBlock(storeId, {
                name, type, rows, cols, columnGaps
            });

            res.status(201).json({
                success: true,
                data: {
                    id: result.id,
                    name: result.name,
                    type: result.type,
                    rows: result.rows,
                    cols: result.cols,
                    columnGaps: result.column_gaps || [],
                    locationsCreated: result.locations?.length || 0
                }
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * PUT /blocks/:id — Update block metadata (name, columnGaps, type)
     * Body: { name?, columnGaps?, type? }
     */
    router.put('/blocks/:id', verifyToken, async (req, res, next) => {
        try {
            const storeId = req.user?.storeId ?? 1;
            const blockId = parseInt(req.params.id);
            const { name, columnGaps, type } = req.body;

            const updated = await warehouseService.updateBlock(storeId, blockId, {
                name, columnGaps, type
            });

            res.json({
                success: true,
                data: {
                    id: updated.id,
                    name: updated.name,
                    type: updated.type,
                    rows: updated.rows,
                    cols: updated.cols,
                    columnGaps: updated.column_gaps || []
                }
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * DELETE /blocks/:id — Delete block (only if no inventory)
     */
    router.delete('/blocks/:id', verifyToken, async (req, res, next) => {
        try {
            const storeId = req.user?.storeId ?? 1;
            const blockId = parseInt(req.params.id);

            const result = await warehouseService.deleteBlock(storeId, blockId);
            res.json({ success: true, ...result });
        } catch (error) {
            next(error);
        }
    });

    // ==========================================
    // LOCATION ENDPOINTS
    // ==========================================

    /**
     * GET /locations — List all locations (?type=, ?blockId=, ?isActive=)
     */
    router.get('/locations', verifyToken, async (req, res, next) => {
        try {
            const storeId = req.user?.storeId ?? 1;
            const filters = {};
            if (req.query.type) filters.type = req.query.type;
            if (req.query.blockId) filters.blockId = parseInt(req.query.blockId);
            if (req.query.isActive !== undefined) filters.isActive = req.query.isActive === 'true';

            const locations = await warehouseService.getLocations(storeId, filters);

            const formatted = locations.map(l => ({
                id: l.id,
                blockId: l.block_id,
                blockName: l.block_name,
                blockType: l.block_type,
                name: l.name,
                position: l.position,
                maxCapacity: l.max_capacity,
                isActive: l.is_active
            }));

            res.json({ success: true, data: formatted });
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /locations/unassigned-items — Get inventory items without a location (for assign dropdown)
     * Returns items grouped by product_id, only items with stock and no location_id
     */
    router.get('/locations/unassigned-items', verifyToken, async (req, res, next) => {
        try {
            const storeId = req.user?.storeId ?? 1;

            const query = `
                SELECT ii.id, ii.product_batch_id, ii.quantity_on_hand, ii.quantity_on_shelf,
                       pb.product_id, pb.cost_price, pb.unit_price,
                       pb.mfg_date, pb.expiry_date, pb.status as batch_status, pb.notes
                FROM inventory_item ii
                JOIN product_batch pb ON ii.product_batch_id = pb.id
                WHERE pb.store_id = $1
                  AND ii.location_id IS NULL
                  AND (ii.quantity_on_hand > 0 OR ii.quantity_on_shelf > 0)
                ORDER BY pb.product_id ASC, pb.expiry_date ASC
            `;
            const { rows } = await warehouseService.pool.query(query, [storeId]);

            // Group by product_id
            const grouped = {};
            for (const row of rows) {
                const pid = row.product_id;
                if (!grouped[pid]) {
                    grouped[pid] = { productId: pid, items: [] };
                }
                grouped[pid].items.push({
                    id: row.id,
                    batchId: row.product_batch_id,
                    quantityOnHand: row.quantity_on_hand || 0,
                    quantityOnShelf: row.quantity_on_shelf || 0,
                    costPrice: parseFloat(row.cost_price) || 0,
                    unitPrice: parseFloat(row.unit_price) || 0,
                    mfgDate: row.mfg_date,
                    expiryDate: row.expiry_date,
                    batchStatus: row.batch_status,
                    notes: row.notes
                });
            }

            res.json({
                success: true,
                data: Object.values(grouped)
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * GET /locations/:id — Location detail with inventory items
     */
    router.get('/locations/:id', verifyToken, async (req, res, next) => {
        try {
            const storeId = req.user?.storeId ?? 1;
            const locationId = parseInt(req.params.id);

            const location = await warehouseService.getLocationById(storeId, locationId);

            res.json({
                success: true,
                data: {
                    id: location.id,
                    blockId: location.block_id,
                    blockName: location.block_name,
                    blockType: location.block_type,
                    name: location.name,
                    position: location.position,
                    maxCapacity: location.max_capacity,
                    isActive: location.is_active,
                    occupiedCapacity: parseInt(location.occupied_capacity) || 0,
                    inventoryItemCount: parseInt(location.inventory_item_count) || 0,
                    inventoryItems: (location.inventoryItems || []).map(ii => ({
                        id: ii.id,
                        batchId: ii.product_batch_id,
                        productId: ii.product_id,
                        costPrice: parseFloat(ii.cost_price) || 0,
                        unitPrice: parseFloat(ii.unit_price) || 0,
                        batchQuantity: ii.batch_quantity,
                        mfgDate: ii.mfg_date,
                        expiryDate: ii.expiry_date,
                        batchStatus: ii.batch_status,
                        batchNotes: ii.batch_notes,
                        quantityOnHand: ii.quantity_on_hand || 0,
                        quantityOnShelf: ii.quantity_on_shelf || 0,
                        quantityReserved: ii.quantity_reserved || 0,
                        reorderPoint: ii.reorder_point || 10
                    }))
                }
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * PUT /locations/:id — Update location (maxCapacity, isActive)
     * Body: { maxCapacity?, isActive? }
     */
    router.put('/locations/:id', verifyToken, async (req, res, next) => {
        try {
            const storeId = req.user?.storeId ?? 1;
            const locationId = parseInt(req.params.id);
            const { maxCapacity, isActive } = req.body;

            const updated = await warehouseService.updateLocation(storeId, locationId, {
                maxCapacity, isActive
            });

            res.json({
                success: true,
                data: {
                    id: updated.id,
                    name: updated.name,
                    maxCapacity: updated.max_capacity,
                    isActive: updated.is_active
                }
            });
        } catch (error) {
            next(error);
        }
    });

    /**
     * DELETE /locations/:id — Delete location (only if empty)
     */
    router.delete('/locations/:id', verifyToken, async (req, res, next) => {
        try {
            const storeId = req.user?.storeId ?? 1;
            const locationId = parseInt(req.params.id);

            const result = await warehouseService.deleteLocation(storeId, locationId);
            res.json({ success: true, ...result });
        } catch (error) {
            next(error);
        }
    });

    // ==========================================
    // ASSIGN / MOVE ENDPOINTS
    // ==========================================

    /**
     * POST /locations/:id/assign — Assign inventory item to location
     * Body: { itemId }
     */
    router.post('/locations/:id/assign', verifyToken, async (req, res, next) => {
        try {
            const storeId = req.user?.storeId ?? 1;
            const userId = req.user?.id || 1;
            const locationId = parseInt(req.params.id);
            const { itemId } = req.body;

            if (!itemId) {
                return res.status(400).json({ success: false, error: 'itemId is required' });
            }

            const result = await warehouseService.assignItemToLocation(storeId, itemId, locationId, userId);
            res.json({ success: true, ...result });
        } catch (error) {
            next(error);
        }
    });

    /**
     * POST /locations/:id/move — Move inventory item to this location
     * Body: { itemId, reason? }
     */
    router.post('/locations/:id/move', verifyToken, async (req, res, next) => {
        try {
            const storeId = req.user?.storeId ?? 1;
            const userId = req.user?.id || 1;
            const toLocationId = parseInt(req.params.id);
            const { itemId, reason } = req.body;

            if (!itemId) {
                return res.status(400).json({ success: false, error: 'itemId is required' });
            }

            const result = await warehouseService.moveItemToLocation(storeId, itemId, toLocationId, userId, reason);
            res.json({ success: true, ...result });
        } catch (error) {
            next(error);
        }
    });

    return router;
}

module.exports = createWarehouseRouter;
