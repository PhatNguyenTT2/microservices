const Redis = require('ioredis');
const logger = require('../../../../shared/common/logger');

let client = null;

/**
 * Redis Cache Layer for Statistics Service
 * Provides get/set/invalidate with automatic JSON serialization
 */
const cache = {
  async connect(redisUrl) {
    try {
      client = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryStrategy(times) {
          if (times > 5) return null;
          return Math.min(times * 200, 2000);
        },
        lazyConnect: true
      });

      await client.connect();
      logger.info('Redis connected');
      return client;
    } catch (err) {
      logger.warn({ err: err.message }, 'Redis connection failed — running without cache');
      client = null;
      return null;
    }
  },

  async get(key) {
    if (!client) return null;
    try {
      const data = await client.get(key);
      return data ? JSON.parse(data) : null;
    } catch (err) {
      logger.warn({ err: err.message, key }, 'Redis GET failed');
      return null;
    }
  },

  async set(key, data, ttlSeconds = 300) {
    if (!client) return;
    try {
      await client.setex(key, ttlSeconds, JSON.stringify(data));
    } catch (err) {
      logger.warn({ err: err.message, key }, 'Redis SET failed');
    }
  },

  async invalidate(pattern) {
    if (!client) return;
    try {
      const keys = await client.keys(pattern);
      if (keys.length > 0) {
        await client.del(...keys);
        logger.info({ pattern, count: keys.length }, 'Cache invalidated');
      }
    } catch (err) {
      logger.warn({ err: err.message, pattern }, 'Redis invalidate failed');
    }
  },

  buildKey(endpoint, storeId, params = {}) {
    const paramStr = Object.entries(params)
      .filter(([, v]) => v != null)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    return `stats:${endpoint}:${storeId || 'global'}:${paramStr}`;
  },

  isConnected() {
    return client !== null && client.status === 'ready';
  },

  async close() {
    if (client) {
      await client.quit();
      client = null;
    }
  }
};

module.exports = cache;
