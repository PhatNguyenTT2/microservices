const { ValidationError, NotFoundError } = require('../../../../shared/common/errors');

/**
 * Warehouse Service
 * Manages Warehouse Blocks & Locations with atomic transactions
 */
class WarehouseService {
    constructor(warehouseRepo, inventoryRepo, pool) {
        this.warehouseRepo = warehouseRepo;
        this.inventoryRepo = inventoryRepo;
        this.pool = pool;
    }

    // ==========================================
    // BLOCK OPERATIONS
    // ==========================================

    async getBlocks(storeId, filters = {}) {
        const blocks = await this.warehouseRepo.findBlocks(storeId, filters);

        // Enrich with locations + capacity
        const enriched = [];
        for (const block of blocks) {
            const locations = await this.warehouseRepo.findLocationsWithCapacityByBlock(block.id);
            enriched.push({
                ...block,
                locations
            });
        }
        return enriched;
    }

    async getBlockById(storeId, blockId) {
        const block = await this.warehouseRepo.findBlockById(storeId, blockId);
        if (!block) throw new NotFoundError(`Block ${blockId} not found`);

        const locations = await this.warehouseRepo.findLocationsWithCapacityByBlock(block.id);
        return { ...block, locations };
    }

    /**
     * Create block with auto-generated locations (atomic)
     * Generates locations like: A-01, A-02, ... A-{rows*cols}
     */
    async createBlock(storeId, data) {
        const { name, type, rows, cols, columnGaps } = data;

        if (!name || !rows || !cols) {
            throw new ValidationError('name, rows, and cols are required');
        }
        if (name.length > 3 || !/^[A-Z0-9]+$/i.test(name.trim())) {
            throw new ValidationError('Block name must be 1-3 alphanumeric characters');
        }

        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            // Create block
            const block = await this.warehouseRepo.createBlockWithClient(client, storeId, {
                name: name.toUpperCase().trim(),
                type: type || 'warehouse',
                rows,
                cols,
                column_gaps: columnGaps || []
            });

            // Generate locations
            const locations = [];
            const totalPositions = rows * cols;
            for (let pos = 1; pos <= totalPositions; pos++) {
                const locationName = `${block.name}-${String(pos).padStart(2, '0')}`;
                const loc = await this.warehouseRepo.createLocationWithClient(client, block.id, {
                    name: locationName,
                    position: pos,
                    max_capacity: 100
                });
                locations.push(loc);
            }

            await client.query('COMMIT');
            return { ...block, locations };
        } catch (error) {
            await client.query('ROLLBACK');
            if (error.code === '23505') {
                throw new ValidationError(`Block name "${name}" already exists in this store`);
            }
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Update block metadata (name, columnGaps, type)
     */
    async updateBlock(storeId, blockId, data) {
        const block = await this.warehouseRepo.findBlockById(storeId, blockId);
        if (!block) throw new NotFoundError(`Block ${blockId} not found`);

        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            const updateData = {};
            if (data.name !== undefined) updateData.name = data.name.toUpperCase().trim();
            if (data.type !== undefined) updateData.type = data.type;
            if (data.columnGaps !== undefined) updateData.column_gaps = data.columnGaps;

            const updated = await this.warehouseRepo.updateBlockWithClient(client, storeId, blockId, updateData);

            await client.query('COMMIT');
            return updated;
        } catch (error) {
            await client.query('ROLLBACK');
            if (error.code === '23505') {
                throw new ValidationError(`Block name "${data.name}" already exists in this store`);
            }
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Delete block (only if no inventory items)
     */
    async deleteBlock(storeId, blockId) {
        const block = await this.warehouseRepo.findBlockById(storeId, blockId);
        if (!block) throw new NotFoundError(`Block ${blockId} not found`);

        const hasInventory = await this.warehouseRepo.blockHasInventory(blockId);
        if (hasInventory) {
            throw new ValidationError('Cannot delete block with active inventory. Move or clear all items first.');
        }

        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await this.warehouseRepo.deleteBlockWithClient(client, storeId, blockId);
            await client.query('COMMIT');
            return { message: 'Block deleted successfully' };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    // ==========================================
    // LOCATION OPERATIONS
    // ==========================================

    async getLocations(storeId, filters = {}) {
        return await this.warehouseRepo.findAllLocations(storeId, filters);
    }

    async getLocationById(storeId, locationId) {
        const location = await this.warehouseRepo.findLocationWithCapacity(locationId);
        if (!location) throw new NotFoundError(`Location ${locationId} not found`);
        if (parseInt(location.store_id) !== parseInt(storeId)) {
            throw new ValidationError('Location does not belong to this store');
        }

        // Get inventory items at this location
        const itemsQuery = `
            SELECT ii.*, pb.product_id, pb.cost_price, pb.unit_price, pb.quantity as batch_quantity,
                   pb.mfg_date, pb.expiry_date, pb.status as batch_status, pb.notes as batch_notes
            FROM inventory_item ii
            JOIN product_batch pb ON ii.product_batch_id = pb.id
            WHERE ii.location_id = $1
            ORDER BY pb.expiry_date ASC
        `;
        const { rows: inventoryItems } = await this.pool.query(itemsQuery, [locationId]);

        return { ...location, inventoryItems };
    }

    async updateLocation(storeId, locationId, data) {
        const location = await this.warehouseRepo.findLocationWithCapacity(locationId);
        if (!location) throw new NotFoundError(`Location ${locationId} not found`);
        if (parseInt(location.store_id) !== parseInt(storeId)) {
            throw new ValidationError('Location does not belong to this store');
        }

        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            const updateData = {};
            if (data.maxCapacity !== undefined) updateData.max_capacity = data.maxCapacity;
            if (data.isActive !== undefined) updateData.is_active = data.isActive;

            const updated = await this.warehouseRepo.updateLocationWithClient(client, locationId, updateData);

            await client.query('COMMIT');
            return updated;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async deleteLocation(storeId, locationId) {
        const location = await this.warehouseRepo.findLocationWithCapacity(locationId);
        if (!location) throw new NotFoundError(`Location ${locationId} not found`);
        if (parseInt(location.store_id) !== parseInt(storeId)) {
            throw new ValidationError('Location does not belong to this store');
        }

        const hasInventory = await this.warehouseRepo.locationHasInventory(locationId);
        if (hasInventory) {
            throw new ValidationError('Cannot delete location with active inventory. Move items first.');
        }

        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await this.warehouseRepo.deleteLocationWithClient(client, locationId);
            await client.query('COMMIT');
            return { message: 'Location deleted successfully' };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    // ==========================================
    // INVENTORY-LOCATION OPERATIONS
    // ==========================================

    /**
     * Assign an inventory item to a location
     * Updates inventory_item.location_id
     */
    async assignItemToLocation(storeId, itemId, locationId, userId) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            // Lock inventory item
            const itemQuery = `
                SELECT ii.*, pb.store_id 
                FROM inventory_item ii
                JOIN product_batch pb ON ii.product_batch_id = pb.id
                WHERE ii.id = $1 FOR UPDATE
            `;
            const { rows: items } = await client.query(itemQuery, [itemId]);
            if (items.length === 0) throw new NotFoundError(`Inventory item ${itemId} not found`);
            
            const item = items[0];
            console.log(`🔍 assignItemToLocation: storeId from JWT = ${storeId} (type: ${typeof storeId}), item.store_id from DB = ${item.store_id} (type: ${typeof item.store_id})`);
            if (parseInt(item.store_id) !== parseInt(storeId)) {
                throw new ValidationError(`Inventory item does not belong to this store (item.store_id=${item.store_id}, jwt.storeId=${storeId})`);
            }

            // Verify target location belongs to store
            const locQuery = `
                SELECT l.*, wb.store_id, wb.type as block_type FROM location l
                JOIN warehouse_block wb ON l.block_id = wb.id
                WHERE l.id = $1 AND wb.store_id = $2 AND l.is_active = true
            `;
            const { rows: locs } = await client.query(locQuery, [locationId, storeId]);
            if (locs.length === 0) {
                throw new ValidationError(`Location ${locationId} not found or inactive`);
            }

            const blockType = locs[0].block_type;
            const isStoreShelf = blockType === 'store_shelf';

            // Check capacity — warehouse counts on_hand, store_shelf counts on_shelf
            const capacityQuery = isStoreShelf
                ? `SELECT COALESCE(SUM(quantity_on_shelf), 0) as occupied FROM inventory_item WHERE location_id = $1`
                : `SELECT COALESCE(SUM(quantity_on_hand), 0) as occupied FROM inventory_item WHERE location_id = $1`;
            const { rows: capRows } = await client.query(capacityQuery, [locationId]);
            const occupied = parseInt(capRows[0]?.occupied || 0);
            const itemQty = isStoreShelf ? item.quantity_on_shelf : item.quantity_on_hand;
            const maxCapacity = locs[0].max_capacity;

            if (occupied + itemQty > maxCapacity) {
                throw new ValidationError(
                    `Location capacity exceeded. Occupied: ${occupied}/${maxCapacity}, Item qty: ${itemQty}`
                );
            }

            // Update location_id
            await client.query(
                'UPDATE inventory_item SET location_id = $1 WHERE id = $2',
                [locationId, itemId]
            );

            // Record movement
            await this.inventoryRepo.recordMovementWithClient(client, {
                inventory_item_id: itemId,
                movement_type: 'transfer',
                quantity: itemQty,
                reason: `assigned_to_location_${locationId}`,
                performed_by: userId
            });

            await client.query('COMMIT');
            return { message: 'Item assigned to location successfully' };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Move an inventory item from one location to another
     */
    async moveItemToLocation(storeId, itemId, toLocationId, userId, reason) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            // Lock inventory item
            const itemQuery = `
                SELECT ii.*, pb.store_id, l.name as from_location_name
                FROM inventory_item ii
                JOIN product_batch pb ON ii.product_batch_id = pb.id
                LEFT JOIN location l ON ii.location_id = l.id
                WHERE ii.id = $1 FOR UPDATE
            `;
            const { rows: items } = await client.query(itemQuery, [itemId]);
            if (items.length === 0) throw new NotFoundError(`Inventory item ${itemId} not found`);
            
            const item = items[0];
            console.log(`🔍 moveItemToLocation: storeId from JWT = ${storeId} (type: ${typeof storeId}), item.store_id from DB = ${item.store_id} (type: ${typeof item.store_id})`);
            if (parseInt(item.store_id) !== parseInt(storeId)) {
                throw new ValidationError(`Inventory item does not belong to this store (item.store_id=${item.store_id}, jwt.storeId=${storeId})`);
            }

            // Verify target location
            const locQuery = `
                SELECT l.*, wb.store_id, wb.type as block_type, l.name as to_location_name 
                FROM location l
                JOIN warehouse_block wb ON l.block_id = wb.id
                WHERE l.id = $1 AND wb.store_id = $2 AND l.is_active = true
            `;
            const { rows: locs } = await client.query(locQuery, [toLocationId, storeId]);
            if (locs.length === 0) {
                throw new ValidationError(`Target location ${toLocationId} not found or inactive`);
            }

            const blockType = locs[0].block_type;
            const isStoreShelf = blockType === 'store_shelf';

            // Check capacity at target — warehouse counts on_hand, store_shelf counts on_shelf
            const capacityQuery = isStoreShelf
                ? `SELECT COALESCE(SUM(quantity_on_shelf), 0) as occupied FROM inventory_item WHERE location_id = $1`
                : `SELECT COALESCE(SUM(quantity_on_hand), 0) as occupied FROM inventory_item WHERE location_id = $1`;
            const { rows: capRows } = await client.query(capacityQuery, [toLocationId]);
            const occupied = parseInt(capRows[0]?.occupied || 0);
            const itemQty = isStoreShelf ? item.quantity_on_shelf : item.quantity_on_hand;

            if (occupied + itemQty > locs[0].max_capacity) {
                throw new ValidationError(
                    `Target location capacity exceeded. Occupied: ${occupied}/${locs[0].max_capacity}, Item qty: ${itemQty}`
                );
            }

            const fromName = item.from_location_name || 'unassigned';
            const toName = locs[0].to_location_name;

            // Update location
            await client.query(
                'UPDATE inventory_item SET location_id = $1 WHERE id = $2',
                [toLocationId, itemId]
            );

            // Record movement
            await this.inventoryRepo.recordMovementWithClient(client, {
                inventory_item_id: itemId,
                movement_type: 'transfer',
                quantity: itemQty,
                reason: reason || `moved_from_${fromName}_to_${toName}`,
                performed_by: userId
            });

            await client.query('COMMIT');
            return { message: `Item moved from ${fromName} to ${toName}` };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}

module.exports = WarehouseService;
