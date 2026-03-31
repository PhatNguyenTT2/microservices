/**
 * Batch Repository
 * Quản lý lô hàng (Multi-Tenancy)
 */
class BatchRepository {
    constructor(pool) {
        this.pool = pool;
    }

    async findAll(storeId, filters = {}) {
        let query = 'SELECT * FROM product_batch WHERE store_id = $1';
        const params = [storeId];

        if (filters.productId) {
            params.push(filters.productId);
            query += ` AND product_id = $${params.length}`;
        }
        if (filters.status) {
            params.push(filters.status);
            query += ` AND status = $${params.length}`;
        }

        query += ' ORDER BY expiry_date ASC NULLS LAST';
        const { rows } = await this.pool.query(query, params);
        return rows;
    }

    async findById(storeId, batchId) {
        const query = 'SELECT * FROM product_batch WHERE id = $1 AND store_id = $2';
        const { rows } = await this.pool.query(query, [batchId, storeId]);
        return rows[0] || null;
    }

    async create(storeId, data) {
        const { product_id, cost_price, unit_price, quantity, mfg_date, expiry_date, notes } = data;
        const query = `
            INSERT INTO product_batch 
            (store_id, product_id, cost_price, unit_price, quantity, mfg_date, expiry_date, notes)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
        `;
        const { rows } = await this.pool.query(query, [
            storeId, product_id, cost_price, unit_price, quantity, mfg_date, expiry_date, notes
        ]);
        return rows[0];
    }
    
    // Tạo qua transaction context
    async createWithClient(client, storeId, data) {
         const { product_id, cost_price, unit_price, quantity, mfg_date, expiry_date, notes } = data;
         const query = `
             INSERT INTO product_batch 
             (store_id, product_id, cost_price, unit_price, quantity, mfg_date, expiry_date, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *
         `;
         const { rows } = await client.query(query, [
             storeId, product_id, cost_price, unit_price, quantity, mfg_date, expiry_date, notes
         ]);
         return rows[0];
    }

    async updateStatusWithClient(client, storeId, batchId, status) {
        const query = `
            UPDATE product_batch 
            SET status = $1
            WHERE id = $2 AND store_id = $3
            RETURNING *
        `;
        const { rows } = await client.query(query, [status, batchId, storeId]);
        return rows[0];
    }

    // Saga compensation: delete orphaned batch (CASCADE deletes inventory_item + movement)
    async deleteById(storeId, batchId) {
        const query = 'DELETE FROM product_batch WHERE id = $1 AND store_id = $2 RETURNING *';
        const { rows } = await this.pool.query(query, [batchId, storeId]);
        return rows[0] || null;
    }
}

module.exports = BatchRepository;
