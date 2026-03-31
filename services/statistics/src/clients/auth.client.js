const axios = require('axios');
const logger = require('../../../../shared/common/logger');

/**
 * Internal HTTP client for Auth Service (:3001)
 * Fetches customers and employees for statistics
 */
class AuthClient {
  constructor(baseURL) {
    this.api = axios.create({
      baseURL,
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async getCustomers(token, filters = {}) {
    try {
      const response = await this.api.get('/api/customers', {
        params: filters,
        headers: { Authorization: `Bearer ${token}` }
      });
      return response.data.data?.customers || [];
    } catch (err) {
      logger.warn({ err: err.message }, 'AuthClient.getCustomers failed');
      return [];
    }
  }

  async getEmployees(token, filters = {}) {
    try {
      const response = await this.api.get('/api/employees', {
        params: filters,
        headers: { Authorization: `Bearer ${token}` }
      });
      return response.data.data?.employees || [];
    } catch (err) {
      logger.warn({ err: err.message }, 'AuthClient.getEmployees failed');
      return [];
    }
  }
}

module.exports = AuthClient;
