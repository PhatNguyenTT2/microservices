/**
 * Payment Repository
 * Quản lý giao dịch thanh toán (Multi-Tenancy)
 */
class PaymentRepository {
    constructor(pool) {
        this.pool = pool;
    }

    async findAll(storeId, filters = {}) {
        let query = 'SELECT * FROM payment WHERE store_id = $1';
        const params = [storeId];

        if (filters.referenceType) {
            params.push(filters.referenceType);
            query += ` AND reference_type = $${params.length}`;
        }

        if (filters.referenceId) {
            params.push(filters.referenceId);
            query += ` AND reference_id = $${params.length}`;
        }

        if (filters.status) {
            params.push(filters.status);
            query += ` AND status = $${params.length}`;
        }

        if (filters.method) {
            params.push(filters.method);
            query += ` AND method = $${params.length}`;
        }

        query += ' ORDER BY payment_date DESC';
        const { rows } = await this.pool.query(query, params);
        return rows;
    }

    async findById(storeId, id) {
        const query = 'SELECT * FROM payment WHERE id = $1 AND store_id = $2';
        const { rows } = await this.pool.query(query, [id, storeId]);
        return rows[0] || null;
    }

    async create(storeId, data) {
        const { amount, method, reference_type, reference_id, created_by, notes } = data;
        const query = `
            INSERT INTO payment 
            (store_id, amount, method, status, reference_type, reference_id, created_by, notes)
            VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7)
            RETURNING *
        `;
        const { rows } = await this.pool.query(query, [
            storeId, amount, method, reference_type, reference_id, created_by, notes
        ]);
        return rows[0];
    }

    async update(storeId, id, data) {
        const fields = [];
        const params = [];
        let idx = 1;

        if (data.amount !== undefined) {
            fields.push(`amount = $${idx++}`);
            params.push(data.amount);
        }
        if (data.method !== undefined) {
            fields.push(`method = $${idx++}`);
            params.push(data.method);
        }
        if (data.notes !== undefined) {
            fields.push(`notes = $${idx++}`);
            params.push(data.notes);
        }
        if (data.status !== undefined) {
            fields.push(`status = $${idx++}`);
            params.push(data.status);
        }

        if (fields.length === 0) return this.findById(storeId, id);

        params.push(id);
        params.push(storeId);
        const query = `
            UPDATE payment 
            SET ${fields.join(', ')}
            WHERE id = $${idx++} AND store_id = $${idx}
            RETURNING *
        `;
        const { rows } = await this.pool.query(query, params);
        return rows[0] || null;
    }

    async delete(storeId, id) {
        const query = `
            DELETE FROM payment 
            WHERE id = $1 AND store_id = $2 AND status IN ('pending', 'cancelled')
            RETURNING *
        `;
        const { rows } = await this.pool.query(query, [id, storeId]);
        return rows[0] || null;
    }

    async updateStatus(storeId, paymentId, status) {
        const query = `
            UPDATE payment 
            SET status = $1
            WHERE id = $2 AND store_id = $3
            RETURNING *
        `;
        const { rows } = await this.pool.query(query, [status, paymentId, storeId]);
        return rows[0];
    }
}

module.exports = PaymentRepository;
