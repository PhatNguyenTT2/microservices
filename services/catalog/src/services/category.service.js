const { ValidationError, NotFoundError } = require('../../../../shared/common/errors');

/**
 * Category Service
 * Xử lý logic nghiệp vụ cho Danh mục (Centralized)
 * Hỗ trợ subcategory 1 cấp (parent_id)
 */
class CategoryService {
    constructor(categoryRepository, productRepository) {
        this.categoryRepository = categoryRepository;
        this.productRepository = productRepository;
    }

    /**
     * Format category row: snake_case → camelCase for frontend
     */
    formatCategory(row) {
        if (!row) return null;
        return {
            id: row.id,
            parentId: row.parent_id || null,
            name: row.name,
            image: row.image_url || null,
            description: row.description || '',
            productCount: row.product_count || 0,
            sortOrder: row.sort_order || 0,
            isPerishable: row.is_perishable || false
        };
    }

    /**
     * Lấy tất cả categories (flat list)
     */
    async getAllCategories(filters = {}) {
        const rows = await this.categoryRepository.findAll(filters);
        return rows.map(row => this.formatCategory(row));
    }

    /**
     * Lấy danh mục dạng cây (root categories + subcategories nested)
     */
    async getCategoryTree() {
        const rows = await this.categoryRepository.findAllWithTree();
        const formatted = rows.map(row => this.formatCategory(row));

        // Build tree: group subcategories under their parent
        const roots = [];
        const childrenMap = {};

        for (const cat of formatted) {
            if (cat.parentId === null) {
                roots.push({ ...cat, children: [] });
            } else {
                if (!childrenMap[cat.parentId]) {
                    childrenMap[cat.parentId] = [];
                }
                childrenMap[cat.parentId].push(cat);
            }
        }

        // Attach children to roots
        for (const root of roots) {
            root.children = childrenMap[root.id] || [];
        }

        return roots;
    }

    async getCategoryById(id) {
        const category = await this.categoryRepository.findById(id);
        if (!category) {
            throw new NotFoundError('Category not found');
        }
        return this.formatCategory(category);
    }

    /**
     * Lấy subcategories của 1 parent
     */
    async getSubcategories(parentId) {
        const parent = await this.categoryRepository.findById(parentId);
        if (!parent) {
            throw new NotFoundError('Parent category not found');
        }
        const rows = await this.categoryRepository.findByParentId(parentId);
        return rows.map(row => this.formatCategory(row));
    }

    async createCategory(data) {
        if (!data.name) {
            throw new ValidationError('Category name is required');
        }

        // Validate parent exists (if provided)
        const parentId = data.parentId !== undefined ? data.parentId : data.parent_id;
        if (parentId) {
            const parent = await this.categoryRepository.findById(parentId);
            if (!parent) {
                throw new NotFoundError('Parent category not found');
            }
            // Ensure parent is a root category (1-level only)
            if (parent.parent_id !== null) {
                throw new ValidationError('Cannot create subcategory under another subcategory (max 1 level)');
            }
        }

        const dbData = {
            parent_id: parentId || null,
            name: data.name,
            image_url: data.image || data.image_url || null,
            description: data.description || null,
            sort_order: data.sortOrder !== undefined ? data.sortOrder : (data.sort_order || 0),
            is_perishable: data.isPerishable !== undefined ? data.isPerishable : (data.is_perishable || false)
        };
        const row = await this.categoryRepository.create(dbData);
        return this.formatCategory({ ...row, product_count: 0 });
    }

    async updateCategory(id, data) {
        await this.getCategoryById(id);

        // Validate parent if changing
        const parentId = data.parentId !== undefined ? data.parentId : data.parent_id;
        if (parentId) {
            if (parseInt(parentId) === parseInt(id)) {
                throw new ValidationError('Category cannot be its own parent');
            }
            const parent = await this.categoryRepository.findById(parentId);
            if (!parent) {
                throw new NotFoundError('Parent category not found');
            }
            if (parent.parent_id !== null) {
                throw new ValidationError('Cannot set subcategory as parent (max 1 level)');
            }
        }

        const dbData = {
            parent_id: parentId,
            name: data.name,
            image_url: data.image !== undefined ? data.image : data.image_url,
            description: data.description,
            sort_order: data.sortOrder !== undefined ? data.sortOrder : data.sort_order,
            is_perishable: data.isPerishable !== undefined ? data.isPerishable : data.is_perishable
        };
        await this.categoryRepository.update(id, dbData);
        return this.getCategoryById(id);
    }

    async deleteCategory(id) {
        const category = await this.getCategoryById(id);

        // Check products in this category
        const products = await this.productRepository.findAll({ categoryId: id });
        if (products.length > 0) {
            throw new ValidationError('Cannot delete category containing products');
        }

        // If root with subcategories that have products, block
        if (category.parentId === null) {
            const subcategories = await this.categoryRepository.findByParentId(id);
            for (const sub of subcategories) {
                const subProducts = await this.productRepository.findAll({ categoryId: sub.id });
                if (subProducts.length > 0) {
                    throw new ValidationError(`Cannot delete: subcategory "${sub.name}" has products`);
                }
            }
            // Subcategories without products will be cascade-deleted
        }

        await this.categoryRepository.delete(id);
        return { message: 'Category deleted successfully' };
    }

    /**
     * Get product IDs from perishable categories (for auto-promotion)
     */
    async getPerishableProductIds() {
        return this.categoryRepository.findPerishableProductIds();
    }
}

module.exports = CategoryService;
