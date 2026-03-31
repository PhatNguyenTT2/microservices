/**
 * Category Repository
 * Quản lý danh mục hàng hoá (Centralized - Không có Multi-Tenancy)
 * Hỗ trợ subcategory 1 cấp (parent_id)
 */
class CategoryRepository {
    constructor(pool) {
        this.pool = pool;
    }

    async findAll(filters = {}) {
        let query = `
            SELECT c.*, 
                (SELECT COUNT(p.id)::int 
                 FROM product p 
                 WHERE p.category_id = c.id OR p.category_id IN (SELECT sub.id FROM category sub WHERE sub.parent_id = c.id)
                ) AS product_count
            FROM category c
        `;
        const params = [];
        const conditions = [];

        if (filters.search) {
            params.push(`%${filters.search}%`);
            conditions.push(`c.name ILIKE $${params.length}`);
        }

        // Filter by parent_id: null = root categories, number = children of that parent
        if (filters.parentId !== undefined) {
            if (filters.parentId === null || filters.parentId === 'null') {
                conditions.push('c.parent_id IS NULL');
            } else {
                params.push(parseInt(filters.parentId));
                conditions.push(`c.parent_id = $${params.length}`);
            }
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' ORDER BY c.sort_order ASC, c.id ASC';

        const { rows } = await this.pool.query(query, params);
        return rows;
    }

    async findById(id) {
        const query = `
            SELECT c.*, 
                (SELECT COUNT(p.id)::int 
                 FROM product p 
                 WHERE p.category_id = c.id OR p.category_id IN (SELECT sub.id FROM category sub WHERE sub.parent_id = c.id)
                ) AS product_count
            FROM category c
            WHERE c.id = $1
        `;
        const { rows } = await this.pool.query(query, [id]);
        return rows[0] || null;
    }

    /**
     * Lấy subcategories của 1 parent
     */
    async findByParentId(parentId) {
        const query = `
            SELECT c.*, 
                (SELECT COUNT(p.id)::int 
                 FROM product p 
                 WHERE p.category_id = c.id OR p.category_id IN (SELECT sub.id FROM category sub WHERE sub.parent_id = c.id)
                ) AS product_count
            FROM category c
            WHERE c.parent_id = $1
            ORDER BY c.sort_order ASC, c.id ASC
        `;
        const { rows } = await this.pool.query(query, [parentId]);
        return rows;
    }

    /**
     * Lấy toàn bộ cây danh mục (roots + subcategories)
     */
    async findAllWithTree() {
        const query = `
            SELECT c.*, 
                (SELECT COUNT(p.id)::int 
                 FROM product p 
                 WHERE p.category_id = c.id OR p.category_id IN (SELECT sub.id FROM category sub WHERE sub.parent_id = c.id)
                ) AS product_count
            FROM category c
            ORDER BY c.parent_id NULLS FIRST, c.sort_order ASC, c.id ASC
        `;
        const { rows } = await this.pool.query(query);
        return rows;
    }

    async create(data) {
        const { parent_id, name, image_url, description, sort_order } = data;
        const query = `
            INSERT INTO category (parent_id, name, image_url, description, sort_order)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `;
        const { rows } = await this.pool.query(query, [
            parent_id || null, name, image_url || null, description || null, sort_order || 0
        ]);
        return rows[0];
    }

    async update(id, data) {
        const { parent_id, name, image_url, description, sort_order } = data;
        const query = `
            UPDATE category 
            SET parent_id = COALESCE($1, parent_id),
                name = COALESCE($2, name),
                image_url = COALESCE($3, image_url),
                description = COALESCE($4, description),
                sort_order = COALESCE($5, sort_order)
            WHERE id = $6
            RETURNING *
        `;
        const { rows } = await this.pool.query(query, [
            parent_id, name, image_url, description, sort_order, id
        ]);
        return rows[0] || null;
    }

    async delete(id) {
        const query = 'DELETE FROM category WHERE id = $1 RETURNING id';
        const { rows } = await this.pool.query(query, [id]);
        return rows[0] || null;
    }
}

module.exports = CategoryRepository;
