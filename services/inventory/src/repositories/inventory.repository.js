/**
 * Inventory Repository
 * Quản lý thẻ kho (InventoryItem) và Movement log
 */
class InventoryRepository {
    constructor(pool) {
        this.pool = pool;
    }

    // --- Inventory Aggregates (View) ---
    async getStoreInventory(storeId, filters = {}) {
        let query = `
            SELECT * FROM v_product_inventory 
            WHERE store_id = $1
        `;
        const params = [storeId];

        if (filters.productId) {
            params.push(filters.productId);
            query += ` AND product_id = $${params.length}`;
        }
        const { rows } = await this.pool.query(query, params);
        return rows;
    }

    // --- Inventory Items ---
    
    // Tìm bằng Client để Lock Row `FOR UPDATE` trong giao dịch xuất/nhập kho
    // When locationId is null, find ANY inventory item for this batch (orders don't track location)
    async findItemForUpdateWithClient(client, batchId, locationId) {
        let query;
        let params;
        if (locationId) {
            query = `SELECT * FROM inventory_item WHERE product_batch_id = $1 AND location_id = $2 FOR UPDATE`;
            params = [batchId, locationId];
        } else {
            // No location specified → find first item for this batch (prefer one with stock)
            query = `SELECT * FROM inventory_item WHERE product_batch_id = $1 ORDER BY (quantity_on_shelf + quantity_on_hand) DESC FOR UPDATE`;
            params = [batchId];
        }
        const { rows } = await client.query(query, params);
        return rows[0] || null;
    }

    async createItemWithClient(client, data) {
        const { product_batch_id, location_id, quantity_on_hand, quantity_on_shelf, reorder_point } = data;
        const query = `
            INSERT INTO inventory_item 
            (product_batch_id, location_id, quantity_on_hand, quantity_on_shelf, reorder_point)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `;
        const { rows } = await client.query(query, [
            product_batch_id, location_id, quantity_on_hand || 0, quantity_on_shelf || 0, reorder_point || 10
        ]);
        return rows[0];
    }

    async updateItemQuantitiesWithClient(client, itemId, diffOnHand, diffOnShelf, diffReserved) {
        const query = `
            UPDATE inventory_item 
            SET quantity_on_hand = quantity_on_hand + $1,
                quantity_on_shelf = quantity_on_shelf + $2,
                quantity_reserved = quantity_reserved + $3
            WHERE id = $4
            RETURNING *
        `;
        const { rows } = await client.query(query, [diffOnHand, diffOnShelf, diffReserved, itemId]);
        return rows[0];
    }

    // --- Movements ---
    async recordMovementWithClient(client, data) {
         const { inventory_item_id, movement_type, quantity, reason, performed_by } = data;
         const query = `
             INSERT INTO inventory_movement 
             (inventory_item_id, movement_type, quantity, reason, performed_by)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING *
         `;
         const { rows } = await client.query(query, [
             inventory_item_id, movement_type, quantity, reason, performed_by
         ]);
         return rows[0];
    }

    // Get movement history for a specific product (across all batches)
    async getMovementsByProduct(storeId, productId, limit = 50) {
        const query = `
            SELECT im.*, ii.product_batch_id, ii.location_id,
                   pb.product_id, pb.cost_price, pb.unit_price
            FROM inventory_movement im
            JOIN inventory_item ii ON im.inventory_item_id = ii.id
            JOIN product_batch pb ON ii.product_batch_id = pb.id
            WHERE pb.store_id = $1 AND pb.product_id = $2
            ORDER BY im.moved_at DESC
            LIMIT $3
        `;
        const { rows } = await this.pool.query(query, [storeId, productId, limit]);
        return rows;
    }

    // Get batches for a product
    async getBatchesByProduct(storeId, productId) {
        const query = `
            SELECT pb.*, 
                   COALESCE(SUM(ii.quantity_on_hand), 0) AS total_on_hand,
                   COALESCE(SUM(ii.quantity_on_shelf), 0) AS total_on_shelf
            FROM product_batch pb
            LEFT JOIN inventory_item ii ON pb.id = ii.product_batch_id
            WHERE pb.store_id = $1 AND pb.product_id = $2
            GROUP BY pb.id
            ORDER BY pb.expiry_date ASC NULLS LAST
        `;
        const { rows } = await this.pool.query(query, [storeId, productId]);
        return rows;
    }

    // Update reorder point on inventory_item rows for a product
    async upsertReorderPoint(storeId, productId, reorderPoint) {
        const query = `
            UPDATE inventory_item ii
            SET reorder_point = $3
            FROM product_batch pb
            WHERE ii.product_batch_id = pb.id
              AND pb.store_id = $1
              AND pb.product_id = $2
            RETURNING ii.*
        `;
        const { rows } = await this.pool.query(query, [storeId, productId, reorderPoint]);
        return rows;
    }

    // Get all inventory items for a product (DetailInventories page)
    async getInventoryItemsByProduct(storeId, productId) {
        const query = `
            SELECT 
                ii.id,
                ii.product_batch_id,
                ii.location_id,
                ii.quantity_on_hand,
                ii.quantity_on_shelf,
                ii.quantity_reserved,
                ii.reorder_point,
                pb.product_id,
                pb.cost_price,
                pb.unit_price,
                pb.quantity AS batch_quantity,
                pb.mfg_date,
                pb.expiry_date,
                pb.status AS batch_status,
                pb.notes AS batch_notes,
                l.id AS loc_id,
                l.name AS loc_name
            FROM inventory_item ii
            JOIN product_batch pb ON ii.product_batch_id = pb.id
            LEFT JOIN location l ON ii.location_id = l.id
            WHERE pb.store_id = $1 AND pb.product_id = $2
            ORDER BY pb.expiry_date ASC NULLS LAST, ii.id ASC
        `;
        const { rows } = await this.pool.query(query, [storeId, productId]);
        return rows;
    }

    // Get movement history for a specific inventory item
    async getMovementsByItem(itemId, limit = 50) {
        const query = `
            SELECT im.*
            FROM inventory_movement im
            WHERE im.inventory_item_id = $1
            ORDER BY im.moved_at DESC
            LIMIT $2
        `;
        const { rows } = await this.pool.query(query, [itemId, limit]);
        return rows;
    }
}

module.exports = InventoryRepository;
