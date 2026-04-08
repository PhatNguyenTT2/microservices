/**
 * Internal API Client — Service-to-service HTTP calls
 * Calls Catalog(:3002), Inventory(:3006), Order(:3003) via internal network
 */

const logger = require('../../../../shared/common/logger');
const { generateToken } = require('../../../../shared/auth-middleware');

const SERVICE_URLS = {
    catalog: process.env.CATALOG_SERVICE_URL || 'http://catalog:3002',
    inventory: process.env.INVENTORY_SERVICE_URL || 'http://inventory:3006',
    order: process.env.ORDER_SERVICE_URL || 'http://order:3003',
    auth: process.env.AUTH_SERVICE_URL || 'http://auth:3001'
};

class ApiClient {
    constructor(token = null) {
        // Use provided token or generate internal service token for S2S calls
        this.token = token || generateToken({
            id: 0,
            username: 'chatbot-service',
            role: 'Admin',
            permissions: ['products.read', 'inventory.read', 'orders.read', 'customers.read']
        }, '24h');
    }

    async _fetch(url, options = {}) {
        const startTime = Date.now();
        const headers = { 'Content-Type': 'application/json' };
        if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

        try {
            const response = await fetch(url, { ...options, headers });
            const data = await response.json();
            const latencyMs = Date.now() - startTime;

            logger.info({ url, status: response.status, latencyMs }, 'Internal API call');

            if (!response.ok) {
                return { success: false, error: data.error || data.message || 'Service error', latencyMs };
            }
            return { success: true, data: data.data, latencyMs };
        } catch (err) {
            const latencyMs = Date.now() - startTime;
            logger.error({ err, url, latencyMs }, 'Internal API call failed');
            return { success: false, error: err.message, latencyMs };
        }
    }

    // ── Catalog Service ───────────────────────────
    async searchProducts(query) {
        const url = `${SERVICE_URLS.catalog}/api/products?search=${encodeURIComponent(query)}`;
        return this._fetch(url);
    }

    async getProductById(productId) {
        const url = `${SERVICE_URLS.catalog}/api/products/${productId}`;
        return this._fetch(url);
    }

    async getAllProducts() {
        const url = `${SERVICE_URLS.catalog}/api/products`;
        return this._fetch(url);
    }

    // ── Inventory Service ─────────────────────────
    async getInventorySummary(storeId, productId = null) {
        let url = `${SERVICE_URLS.inventory}/api/inventory/summary`;
        if (productId) url += `?productId=${productId}`;
        return this._fetch(url);
    }

    async getStoreInventory(storeId) {
        const url = `${SERVICE_URLS.inventory}/api/inventory/summary?storeId=${storeId}`;
        return this._fetch(url);
    }

    // ── Order Service ─────────────────────────────
    async getOrderById(orderId) {
        const url = `${SERVICE_URLS.order}/api/orders/${orderId}`;
        return this._fetch(url);
    }

    async getOrders(filters = {}) {
        const params = new URLSearchParams();
        if (filters.status) params.set('status', filters.status);
        if (filters.paymentStatus) params.set('paymentStatus', filters.paymentStatus);
        const url = `${SERVICE_URLS.order}/api/orders?${params.toString()}`;
        return this._fetch(url);
    }

    // ── Auth Service ──────────────────────────────
    async getCustomerProfile(customerId) {
        const url = `${SERVICE_URLS.auth}/api/customers/${customerId}`;
        return this._fetch(url);
    }

    async getStores() {
        const url = `${SERVICE_URLS.auth}/api/stores`;
        return this._fetch(url);
    }
}

module.exports = ApiClient;
