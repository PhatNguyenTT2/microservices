const axios = require('axios');
const logger = require('../../../../shared/common/logger');

/**
 * Internal HTTP client for Catalog Service (:3002)
 * Fetches products and categories for statistics
 */
class CatalogClient {
  constructor(baseURL) {
    this.api = axios.create({
      baseURL,
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async getProducts(token, filters = {}) {
    try {
      const response = await this.api.get('/api/products', {
        params: filters,
        headers: { Authorization: `Bearer ${token}` }
      });
      return response.data.data?.products || [];
    } catch (err) {
      logger.warn({ err: err.message }, 'CatalogClient.getProducts failed');
      return [];
    }
  }

  async getCategories(token) {
    try {
      const response = await this.api.get('/api/categories', {
        headers: { Authorization: `Bearer ${token}` }
      });
      return response.data.data?.categories || [];
    } catch (err) {
      logger.warn({ err: err.message }, 'CatalogClient.getCategories failed');
      return [];
    }
  }
}

module.exports = CatalogClient;
