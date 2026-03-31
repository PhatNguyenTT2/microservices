/**
 * Product Repository
 * Quản lý hàng hoá (Centralized - Không có Multi-Tenancy)
 */
class ProductRepository {
    constructor(pool) {
        this.pool = pool;
    }

    async findAll(filters = {}) {
        let query = `
            SELECT p.*, c.name as category_name 
            FROM product p
            LEFT JOIN category c ON p.category_id = c.id
            WHERE 1=1
        `;
        const params = [];

        if (filters.categoryId) {
            // Support comma-separated category IDs
            const ids = String(filters.categoryId).split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
            if (ids.length === 1) {
                params.push(ids[0]);
                query += ` AND p.category_id = $${params.length}`;
            } else if (ids.length > 1) {
                params.push(ids);
                query += ` AND p.category_id = ANY($${params.length})`;
            }
        }

        if (filters.search) {
            params.push(`%${filters.search}%`);
            query += ` AND (p.name ILIKE $${params.length} OR p.vendor ILIKE $${params.length})`;
        }

        if (filters.isActive !== undefined) {
            params.push(filters.isActive);
            query += ` AND p.is_active = $${params.length}`;
        }

        if (filters.vendor) {
            params.push(`%${filters.vendor}%`);
            query += ` AND p.vendor ILIKE $${params.length}`;
        }

        query += ' ORDER BY p.id DESC';
        const { rows } = await this.pool.query(query, params);
        return rows;
    }

    /**
     * Find all products with pagination support
     */
    async findAllPaginated(filters = {}, page = 1, perPage = 20) {
        let baseWhere = ' WHERE 1=1';
        const params = [];

        if (filters.categoryId) {
            const ids = String(filters.categoryId).split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
            if (ids.length === 1) {
                params.push(ids[0]);
                baseWhere += ` AND p.category_id = $${params.length}`;
            } else if (ids.length > 1) {
                params.push(ids);
                baseWhere += ` AND p.category_id = ANY($${params.length})`;
            }
        }

        if (filters.search) {
            params.push(`%${filters.search}%`);
            baseWhere += ` AND (p.name ILIKE $${params.length} OR p.vendor ILIKE $${params.length})`;
        }

        if (filters.isActive !== undefined) {
            params.push(filters.isActive);
            baseWhere += ` AND p.is_active = $${params.length}`;
        }

        if (filters.vendor) {
            params.push(`%${filters.vendor}%`);
            baseWhere += ` AND p.vendor ILIKE $${params.length}`;
        }

        // Count total
        const countQuery = `SELECT COUNT(*)::int as total FROM product p${baseWhere}`;
        const countResult = await this.pool.query(countQuery, params);
        const total = countResult.rows[0]?.total || 0;

        // Sort
        let orderBy = ' ORDER BY p.id DESC';
        if (filters.sort) {
            const sortMap = { name: 'p.name', unitPrice: 'p.unit_price', id: 'p.id', newest: 'p.id' };
            const sortCol = sortMap[filters.sort] || 'p.id';
            const sortDir = filters.order === 'asc' ? 'ASC' : 'DESC';
            orderBy = ` ORDER BY ${sortCol} ${sortDir}`;
        }

        // Paginate
        const offset = (page - 1) * perPage;
        params.push(perPage);
        params.push(offset);

        const dataQuery = `
            SELECT p.*, c.name as category_name
            FROM product p
            LEFT JOIN category c ON p.category_id = c.id
            ${baseWhere}${orderBy}
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `;
        const { rows } = await this.pool.query(dataQuery, params);

        return {
            rows,
            total,
            page,
            perPage,
            pages: Math.ceil(total / perPage)
        };
    }

    async findById(id) {
        const query = `
            SELECT p.*, c.name as category_name 
            FROM product p
            LEFT JOIN category c ON p.category_id = c.id
            WHERE p.id = $1
        `;
        const { rows } = await this.pool.query(query, [id]);
        return rows[0] || null;
    }

    async create(data) {
        const { category_id, name, image_url, unit_price, vendor, is_active } = data;
        const query = `
            INSERT INTO product (category_id, name, image_url, unit_price, vendor, is_active)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
        `;
        const { rows } = await this.pool.query(query, [
            category_id, name, image_url || null, unit_price || 0, vendor || null, is_active !== false
        ]);
        return rows[0];
    }

    async update(id, data) {
        const { name, image_url, category_id, unit_price, vendor, is_active } = data;
        const query = `
            UPDATE product 
            SET name = COALESCE($1, name),
                image_url = COALESCE($2, image_url),
                category_id = COALESCE($3, category_id),
                unit_price = COALESCE($4, unit_price),
                vendor = COALESCE($5, vendor),
                is_active = COALESCE($6, is_active)
            WHERE id = $7
            RETURNING *
        `;
        const { rows } = await this.pool.query(query, [
            name, image_url, category_id, unit_price, vendor, is_active, id
        ]);
        return rows[0] || null;
    }

    async updateStatus(id, isActive) {
        const query = `
            UPDATE product 
            SET is_active = $1
            WHERE id = $2
            RETURNING *
        `;
        const { rows } = await this.pool.query(query, [isActive, id]);
        return rows[0] || null;
    }

    async delete(id) {
        const query = 'DELETE FROM product WHERE id = $1 RETURNING id';
        const { rows } = await this.pool.query(query, [id]);
        return rows[0] || null;
    }
    
    async updatePriceWithClient(client, id, newPrice) {
        const query = `
            UPDATE product 
            SET unit_price = $1
            WHERE id = $2
            RETURNING *
        `;
        const { rows } = await client.query(query, [newPrice, id]);
        return rows[0];
    }
}

module.exports = ProductRepository;
