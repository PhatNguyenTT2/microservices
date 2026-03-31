/**
 * Employee Repository
 * Refactored for Multi-Tenancy: Thêm trường store_id
 */
class EmployeeRepository {
    constructor(pool) {
        this.pool = pool;
    }

    async findAll(filters = {}) {
        let query = `
            SELECT 
                u.id, u.username, u.email, u.is_active, u.last_login,
                r.name as role_name,
                e.full_name, e.address, e.phone, e.gender, e.dob, e.store_id,
                s.name as store_name
            FROM user_account u
            JOIN employee e ON u.id = e.user_id
            JOIN role r ON u.role_id = r.id
            LEFT JOIN store s ON e.store_id = s.id
            WHERE 1=1
        `;
        const params = [];
        
        if (filters.storeId) {
             params.push(filters.storeId);
             query += ` AND e.store_id = $${params.length}`;
        }

        query += ' ORDER BY u.id DESC';
        const { rows } = await this.pool.query(query, params);
        return rows;
    }

    async findById(userId) {
        const query = `
            SELECT 
                u.id, u.username, u.email, u.is_active, u.last_login,
                r.name as role_name,
                e.full_name, e.address, e.phone, e.gender, e.dob, e.store_id,
                s.name as store_name
            FROM user_account u
            JOIN employee e ON u.id = e.user_id
            JOIN role r ON u.role_id = r.id
            LEFT JOIN store s ON e.store_id = s.id
            WHERE u.id = $1
        `;
        const { rows } = await this.pool.query(query, [userId]);
        return rows[0] || null;
    }

    // Dùng chung transaction từ Service
    async createProfile(client, userId, storeId, employeeData) {
        const { full_name, address, phone, gender, dob } = employeeData;
        const query = `
            INSERT INTO employee 
            (user_id, store_id, full_name, address, phone, gender, dob)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
        `;
        const { rows } = await client.query(query, [
            userId, storeId, full_name, address, phone, gender, dob
        ]);
        return rows[0];
    }
    
    async updateProfile(client, userId, storeId, employeeData) {
         const { full_name, address, phone, gender, dob } = employeeData;
         const query = `
             UPDATE employee 
             SET store_id = COALESCE($1, store_id),
                 full_name = COALESCE($2, full_name),
                 address = COALESCE($3, address),
                 phone = COALESCE($4, phone),
                 gender = COALESCE($5, gender),
                 dob = COALESCE($6, dob)
             WHERE user_id = $7
             RETURNING *
         `;
         const { rows } = await client.query(query, [
             storeId, full_name, address, phone, gender, dob, userId
         ]);
         return rows[0];
    }
}

module.exports = EmployeeRepository;
