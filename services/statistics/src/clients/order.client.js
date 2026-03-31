const axios = require('axios');
const logger = require('../../../../shared/common/logger');

/**
 * Internal HTTP client for Order Service (:3003)
 * Fetches orders and order details for statistics aggregation
 */
class OrderClient {
  constructor(baseURL) {
    this.api = axios.create({
      baseURL,
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async getOrders(token, filters = {}) {
    try {
      const params = {};
      if (filters.status) params.status = filters.status;
      if (filters.paymentStatus) params.paymentStatus = filters.paymentStatus;

      const response = await this.api.get('/api/orders', {
        params,
        headers: { Authorization: `Bearer ${token}` }
      });

      return response.data.data?.orders || [];
    } catch (err) {
      logger.warn({ err: err.message }, 'OrderClient.getOrders failed');
      return [];
    }
  }

  async getOrderById(token, orderId) {
    try {
      const response = await this.api.get(`/api/orders/${orderId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      return response.data.data?.order || null;
    } catch (err) {
      logger.warn({ err: err.message, orderId }, 'OrderClient.getOrderById failed');
      return null;
    }
  }
}

module.exports = OrderClient;
