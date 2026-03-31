/**
 * Store Repository
 * Quản lý thông tin cửa hàng ban đầu
 */
class StoreRepository {
    constructor(pool) {
        this.pool = pool;
    }

    async findAll() {
        const query = 'SELECT * FROM store ORDER BY id ASC';
        const { rows } = await this.pool.query(query);
        return rows;
    }

    async findById(id) {
        const query = 'SELECT * FROM store WHERE id = $1';
        const { rows } = await this.pool.query(query, [id]);
        return rows[0] || null;
    }

    async create(data) {
        const { name, address, phone, manager_id } = data;
        const query = `
            INSERT INTO store (name, address, phone, manager_id)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `;
        const { rows } = await this.pool.query(query, [name, address, phone, manager_id]);
        return rows[0];
    }

    async update(id, data) {
        const { name, address, phone, manager_id, is_active } = data;
        const query = `
            UPDATE store 
            SET name = COALESCE($1, name),
                address = COALESCE($2, address),
                phone = COALESCE($3, phone),
                manager_id = COALESCE($4, manager_id),
                is_active = COALESCE($5, is_active)
            WHERE id = $6
            RETURNING *
        `;
        const { rows } = await this.pool.query(query, [name, address, phone, manager_id, is_active, id]);
        return rows[0];
    }

    async createWithClient(client, data) {
        const { name, address, phone, manager_id } = data;
        const query = `
            INSERT INTO store (name, address, phone, manager_id)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `;
        const { rows } = await client.query(query, [name, address, phone, manager_id || null]);
        return rows[0];
    }

    async updateManagerWithClient(client, storeId, managerId) {
        const query = 'UPDATE store SET manager_id = $1 WHERE id = $2 RETURNING *';
        const { rows } = await client.query(query, [managerId, storeId]);
        return rows[0];
    }
}

module.exports = StoreRepository;
