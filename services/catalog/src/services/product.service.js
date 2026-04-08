const { ValidationError, NotFoundError, AppError } = require('../../../../shared/common/errors');
const EVENT = require('../../../../shared/event-bus/eventTypes');
const logger = require('../../../../shared/common/logger');

/**
 * Product Service
 * Xử lý logic cho Sản phẩm và cập nhật giá (Zone 1)
 */
class ProductService {
    constructor(productRepository, categoryRepository, priceHistoryRepository, dbPool, eventBus = null) {
        this.productRepository = productRepository;
        this.categoryRepository = categoryRepository;
        this.priceHistoryRepository = priceHistoryRepository;
        this.pool = dbPool;
        this.eventBus = eventBus;
    }

    /**
     * Format product row: snake_case → camelCase for frontend
     */
    formatProduct(row) {
        if (!row) return null;
        return {
            id: row.id,
            name: row.name,
            image: row.image_url || null,
            unitPrice: Number(row.unit_price) || 0,
            isActive: row.is_active !== false,
            categoryId: row.category_id,
            categoryName: row.category_name || '',
            category: row.category_name ? { id: row.category_id, name: row.category_name } : null,
            vendor: row.vendor || ''
        };
    }

    async getProducts(filters) {
        const rows = await this.productRepository.findAll(filters);
        return rows.map(row => this.formatProduct(row));
    }

    async getProductsPaginated(filters, page = 1, perPage = 20) {
        const result = await this.productRepository.findAllPaginated(filters, page, perPage);
        return {
            products: result.rows.map(row => this.formatProduct(row)),
            pagination: {
                total: result.total,
                page: result.page,
                perPage: result.perPage,
                pages: result.pages
            }
        };
    }

    async getProductById(id) {
        const product = await this.productRepository.findById(id);
        if (!product) {
            throw new NotFoundError('Product not found');
        }
        return this.formatProduct(product);
    }

    async createProduct(data) {
        // Map frontend camelCase → DB snake_case
        const categoryId = data.categoryId || data.category_id || data.category;
        const category = await this.categoryRepository.findById(categoryId);
        if (!category) {
            throw new ValidationError('Category does not exist');
        }

        if (!data.name) {
            throw new ValidationError('Product name is required');
        }

        const unitPrice = data.unitPrice !== undefined ? data.unitPrice : data.unit_price;
        if (unitPrice < 0) {
            throw new ValidationError('Unit price cannot be negative');
        }

        const dbData = {
            category_id: categoryId,
            name: data.name,
            image_url: data.image || data.image_url || null,
            unit_price: unitPrice || 0,
            vendor: data.vendor || null,
            is_active: data.isActive !== undefined ? data.isActive : data.is_active
        };

        const row = await this.productRepository.create(dbData);
        const product = await this.getProductById(row.id);

        if (this.eventBus) {
            try {
                await this.eventBus.publish(EVENT.PRODUCT_CREATED, {
                    productId: product.id, name: product.name,
                    categoryId: product.categoryId, categoryName: product.categoryName,
                    unitPrice: product.unitPrice, vendor: product.vendor
                });
            } catch (err) {
                logger.error({ err, productId: product.id }, 'Failed to publish product.created event');
            }
        }

        return product;
    }

    async updateProduct(id, data) {
        await this.getProductById(id); // Check exists

        // If changing category, validate it
        const categoryId = data.categoryId || data.category_id || data.category;
        if (categoryId) {
            const category = await this.categoryRepository.findById(categoryId);
            if (!category) {
                throw new ValidationError('Category does not exist');
            }
        }

        const dbData = {
            name: data.name,
            image_url: data.image !== undefined ? data.image : data.image_url,
            category_id: categoryId || undefined,
            unit_price: data.unitPrice !== undefined ? data.unitPrice : data.unit_price,
            vendor: data.vendor,
            is_active: data.isActive !== undefined ? data.isActive : data.is_active
        };

        await this.productRepository.update(id, dbData);
        const product = await this.getProductById(id);

        if (this.eventBus) {
            try {
                await this.eventBus.publish(EVENT.PRODUCT_UPDATED, {
                    productId: product.id, name: product.name,
                    categoryId: product.categoryId, categoryName: product.categoryName,
                    unitPrice: product.unitPrice, vendor: product.vendor
                });
            } catch (err) {
                logger.error({ err, productId: product.id }, 'Failed to publish product.updated event');
            }
        }

        return product;
    }

    async updateStatus(id, isActive) {
        await this.getProductById(id);
        await this.productRepository.updateStatus(id, isActive);
        return this.getProductById(id);
    }

    async deleteProduct(id) {
        const product = await this.getProductById(id);
        await this.productRepository.delete(id);

        if (this.eventBus) {
            try {
                await this.eventBus.publish(EVENT.PRODUCT_DELETED, {
                    productId: parseInt(id), name: product.name
                });
            } catch (err) {
                logger.error({ err, productId: id }, 'Failed to publish product.deleted event');
            }
        }

        return { message: 'Product deleted successfully' };
    }

    /**
     * Zone 1: TRANSACTION CẬP NHẬT GIÁ
     */
    async updatePrice(id, newPrice, reason, changedByUserId) {
        if (newPrice < 0) {
            throw new ValidationError('New price cannot be negative');
        }
        if (!reason) {
            throw new ValidationError('Must provide reason for price change');
        }

        const rawProduct = await this.productRepository.findById(id);
        if (!rawProduct) {
            throw new NotFoundError('Product not found');
        }

        if (Number(rawProduct.unit_price) === Number(newPrice)) {
            throw new ValidationError('New price is same as current price');
        }

        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            await this.productRepository.updatePriceWithClient(client, id, newPrice);

            const logData = {
                product_id: id,
                old_price: rawProduct.unit_price,
                new_price: newPrice,
                reason: reason,
                changed_by: changedByUserId
            };
            await this.priceHistoryRepository.createWithClient(client, logData);

            await client.query('COMMIT');

            if (this.eventBus) {
                try {
                    await this.eventBus.publish(EVENT.PRODUCT_PRICE_CHANGED, {
                        productId: parseInt(id),
                        oldPrice: Number(rawProduct.unit_price),
                        newPrice: Number(newPrice)
                    });
                } catch (err) {
                    logger.error({ err, productId: id }, 'Failed to publish product.price_changed event');
                }
            }

            return this.getProductById(id);
        } catch (error) {
            await client.query('ROLLBACK');
            throw new AppError('Failed to update product price: ' + error.message, 500);
        } finally {
            client.release();
        }
    }

    async getPriceHistory(id) {
        await this.getProductById(id);
        return await this.priceHistoryRepository.getHistoryByProductId(id);
    }
}

module.exports = ProductService;
