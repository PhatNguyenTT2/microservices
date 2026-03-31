/**
 * Stock Out Repository
 * Quản lý phiếu xuất kho (Multi-Tenancy)
 */
class StockOutRepository {
    constructor(pool) {
        this.pool = pool;
    }

    async findAll(storeId, filters = {}) {
        let query = 'SELECT * FROM stock_out_order WHERE store_id = $1';
        const params = [storeId];

        if (filters.status) {
            params.push(filters.status);
            query += ` AND status = $${params.length}`;
        }
        if (filters.reason) {
            params.push(filters.reason);
            query += ` AND reason = $${params.length}`;
        }
        query += ' ORDER BY order_date DESC';
        const { rows } = await this.pool.query(query, params);
        return rows;
    }

    async findById(storeId, id) {
        const query = 'SELECT * FROM stock_out_order WHERE id = $1 AND store_id = $2';
        const { rows } = await this.pool.query(query, [id, storeId]);
        return rows[0] || null;
    }

    async findDetails(soId) {
        const query = `
            SELECT sod.*, pb.product_id, pb.unit_price as batch_unit_price, 
                   pb.expiry_date, pb.mfg_date, pb.quantity as batch_quantity
            FROM stock_out_detail sod
            JOIN product_batch pb ON sod.batch_id = pb.id
            WHERE sod.so_id = $1
        `;
        const { rows } = await this.pool.query(query, [soId]);
        return rows;
    }

    // Create with transaction client
    async createOrderWithClient(client, storeId, data) {
        const { reason, destination, total_price, created_by } = data;
        const query = `
            INSERT INTO stock_out_order 
            (store_id, reason, destination, status, total_price, created_by)
            VALUES ($1, $2, $3, 'draft', $4, $5)
            RETURNING *
        `;
        const { rows } = await client.query(query, [
            storeId, reason, destination, total_price || 0, created_by
        ]);
        return rows[0];
    }

    async addDetailWithClient(client, soId, data) {
        const { batch_id, quantity, unit_price, total_price } = data;
        const query = `
            INSERT INTO stock_out_detail 
            (so_id, batch_id, quantity, unit_price, total_price)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `;
        const { rows } = await client.query(query, [
            soId, batch_id, quantity, unit_price || 0, total_price || 0
        ]);
        return rows[0];
    }

    // Update header fields
    async updateOrderWithClient(client, storeId, soId, data) {
        const { reason, destination } = data;
        const query = `
            UPDATE stock_out_order 
            SET reason = COALESCE($1, reason), 
                destination = COALESCE($2, destination)
            WHERE id = $3 AND store_id = $4
            RETURNING *
        `;
        const { rows } = await client.query(query, [reason, destination, soId, storeId]);
        return rows[0];
    }

    // Delete all details for an order
    async deleteAllDetailsWithClient(client, soId) {
        await client.query('DELETE FROM stock_out_detail WHERE so_id = $1', [soId]);
    }

    // Delete order (header + details cascade)
    async deleteOrderWithClient(client, storeId, soId) {
        const query = 'DELETE FROM stock_out_order WHERE id = $1 AND store_id = $2 RETURNING *';
        const { rows } = await client.query(query, [soId, storeId]);
        return rows[0];
    }

    // Status update with transaction client
    async updateStatusWithClient(client, storeId, soId, status) {
        let updateDateStr = '';
        if (status === 'completed') {
            updateDateStr = ', completed_date = NOW()';
        }

        const query = `
            UPDATE stock_out_order 
            SET status = $1 ${updateDateStr}
            WHERE id = $2 AND store_id = $3
            RETURNING *
        `;
        const { rows } = await client.query(query, [status, soId, storeId]);
        return rows[0];
    }
}

module.exports = StockOutRepository;
