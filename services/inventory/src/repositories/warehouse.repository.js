/**
 * Warehouse Repository
 * Quản lý Block Kho & Vị Trí (Location) (Multi-Tenancy)
 * Full CRUD for warehouse_block + location tables
 */
class WarehouseRepository {
    constructor(pool) {
        this.pool = pool;
    }

    // ==========================================
    // BLOCK OPERATIONS
    // ==========================================

    async findBlocks(storeId, filters = {}) {
        let query = 'SELECT * FROM warehouse_block WHERE store_id = $1';
        const params = [storeId];

        if (filters.type) {
            params.push(filters.type);
            query += ` AND type = $${params.length}`;
        }

        query += ' ORDER BY name ASC';
        const { rows } = await this.pool.query(query, params);
        return rows;
    }

    async findBlockById(storeId, blockId) {
        const query = 'SELECT * FROM warehouse_block WHERE id = $1 AND store_id = $2';
        const { rows } = await this.pool.query(query, [blockId, storeId]);
        return rows[0] || null;
    }

    async createBlockWithClient(client, storeId, data) {
        const { name, type, rows, cols, column_gaps } = data;
        const query = `
            INSERT INTO warehouse_block (store_id, name, type, rows, cols, column_gaps)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `;
        const formattedGaps = column_gaps ? `{${column_gaps.join(',')}}` : '{}';
        const blockType = type || 'warehouse';

        const { rows: result } = await client.query(query, [storeId, name, blockType, rows, cols, formattedGaps]);
        return result[0];
    }

    async updateBlockWithClient(client, storeId, blockId, data) {
        const sets = [];
        const params = [];
        let paramIdx = 1;

        if (data.name !== undefined) {
            sets.push(`name = $${paramIdx++}`);
            params.push(data.name);
        }
        if (data.type !== undefined) {
            sets.push(`type = $${paramIdx++}`);
            params.push(data.type);
        }
        if (data.rows !== undefined) {
            sets.push(`rows = $${paramIdx++}`);
            params.push(data.rows);
        }
        if (data.cols !== undefined) {
            sets.push(`cols = $${paramIdx++}`);
            params.push(data.cols);
        }
        if (data.column_gaps !== undefined) {
            sets.push(`column_gaps = $${paramIdx++}`);
            params.push(`{${data.column_gaps.join(',')}}`);
        }

        if (sets.length === 0) return await this.findBlockById(storeId, blockId);

        params.push(blockId, storeId);
        const query = `
            UPDATE warehouse_block 
            SET ${sets.join(', ')} 
            WHERE id = $${paramIdx++} AND store_id = $${paramIdx}
            RETURNING *
        `;
        const { rows } = await client.query(query, params);
        return rows[0] || null;
    }

    async deleteBlockWithClient(client, storeId, blockId) {
        const query = 'DELETE FROM warehouse_block WHERE id = $1 AND store_id = $2 RETURNING id';
        const { rows } = await client.query(query, [blockId, storeId]);
        return rows[0] || null;
    }

    // ==========================================
    // LOCATION OPERATIONS
    // ==========================================

    async findLocationsByBlock(blockId) {
        const query = 'SELECT * FROM location WHERE block_id = $1 ORDER BY position ASC';
        const { rows } = await this.pool.query(query, [blockId]);
        return rows;
    }

    async findLocationById(locationId) {
        const query = `
            SELECT l.*, wb.store_id, wb.name as block_name, wb.type as block_type
            FROM location l
            JOIN warehouse_block wb ON l.block_id = wb.id
            WHERE l.id = $1
        `;
        const { rows } = await this.pool.query(query, [locationId]);
        return rows[0] || null;
    }

    async findAllLocations(storeId, filters = {}) {
        let query = `
            SELECT l.*, wb.name as block_name, wb.type as block_type,
                   wb.rows as block_rows, wb.cols as block_cols, wb.column_gaps
            FROM location l
            JOIN warehouse_block wb ON l.block_id = wb.id
            WHERE wb.store_id = $1
        `;
        const params = [storeId];

        if (filters.type) {
            params.push(filters.type);
            query += ` AND wb.type = $${params.length}`;
        }
        if (filters.blockId) {
            params.push(filters.blockId);
            query += ` AND l.block_id = $${params.length}`;
        }
        if (filters.isActive !== undefined) {
            params.push(filters.isActive);
            query += ` AND l.is_active = $${params.length}`;
        }

        query += ' ORDER BY wb.name ASC, l.position ASC';
        const { rows } = await this.pool.query(query, params);
        return rows;
    }

    async createLocationWithClient(client, blockId, data) {
        const { name, position, max_capacity } = data;
        const query = `
            INSERT INTO location (block_id, name, position, max_capacity)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `;
        const { rows } = await client.query(query, [blockId, name, position, max_capacity || 100]);
        return rows[0];
    }

    async updateLocationWithClient(client, locationId, data) {
        const sets = [];
        const params = [];
        let paramIdx = 1;

        if (data.max_capacity !== undefined) {
            sets.push(`max_capacity = $${paramIdx++}`);
            params.push(data.max_capacity);
        }
        if (data.is_active !== undefined) {
            sets.push(`is_active = $${paramIdx++}`);
            params.push(data.is_active);
        }
        if (data.name !== undefined) {
            sets.push(`name = $${paramIdx++}`);
            params.push(data.name);
        }

        if (sets.length === 0) return null;

        params.push(locationId);
        const query = `
            UPDATE location SET ${sets.join(', ')} WHERE id = $${paramIdx}
            RETURNING *
        `;
        const { rows } = await client.query(query, params);
        return rows[0] || null;
    }

    async deleteLocationWithClient(client, locationId) {
        const query = 'DELETE FROM location WHERE id = $1 RETURNING id';
        const { rows } = await client.query(query, [locationId]);
        return rows[0] || null;
    }

    /**
     * Get location with inventory item count (for capacity info)
     */
    async findLocationWithCapacity(locationId) {
        const query = `
            SELECT l.*,
                   wb.name as block_name, wb.type as block_type, wb.store_id,
                   CASE wb.type
                       WHEN 'store_shelf' THEN COALESCE(SUM(ii.quantity_on_shelf), 0)
                       ELSE COALESCE(SUM(ii.quantity_on_hand), 0)
                   END AS occupied_capacity,
                   COUNT(ii.id) AS inventory_item_count
            FROM location l
            JOIN warehouse_block wb ON l.block_id = wb.id
            LEFT JOIN inventory_item ii ON ii.location_id = l.id
            WHERE l.id = $1
            GROUP BY l.id, wb.name, wb.type, wb.store_id
        `;
        const { rows } = await this.pool.query(query, [locationId]);
        return rows[0] || null;
    }

    /**
     * Get locations with capacity info for a block
     */
    async findLocationsWithCapacityByBlock(blockId) {
        const query = `
            SELECT l.*,
                   CASE wb.type
                       WHEN 'store_shelf' THEN COALESCE(SUM(ii.quantity_on_shelf), 0)
                       ELSE COALESCE(SUM(ii.quantity_on_hand), 0)
                   END AS occupied_capacity,
                   COUNT(ii.id) AS inventory_item_count
            FROM location l
            JOIN warehouse_block wb ON l.block_id = wb.id
            LEFT JOIN inventory_item ii ON ii.location_id = l.id
            WHERE l.block_id = $1
            GROUP BY l.id, wb.type
            ORDER BY l.position ASC
        `;
        const { rows } = await this.pool.query(query, [blockId]);
        return rows;
    }

    /**
     * Check if a block has any inventory items (prevents deletion)
     */
    async blockHasInventory(blockId) {
        const query = `
            SELECT EXISTS(
                SELECT 1 FROM inventory_item ii
                JOIN location l ON ii.location_id = l.id
                WHERE l.block_id = $1
            ) AS has_inventory
        `;
        const { rows } = await this.pool.query(query, [blockId]);
        return rows[0]?.has_inventory || false;
    }

    /**
     * Check if a location has any inventory items
     */
    async locationHasInventory(locationId) {
        const query = `
            SELECT EXISTS(
                SELECT 1 FROM inventory_item 
                WHERE location_id = $1 AND (quantity_on_hand > 0 OR quantity_on_shelf > 0 OR quantity_reserved > 0)
            ) AS has_inventory
        `;
        const { rows } = await this.pool.query(query, [locationId]);
        return rows[0]?.has_inventory || false;
    }
}

module.exports = WarehouseRepository;
