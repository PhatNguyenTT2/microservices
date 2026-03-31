/**
 * Shared constants used across services.
 */

const SALT_ROUNDS = 10;

const TOKEN_EXPIRY = {
  ACCESS: process.env.JWT_EXPIRES_IN || '7d',
  POS: '12h',
  REFRESH_MS: 7 * 24 * 60 * 60 * 1000 // 7 days in ms
};

module.exports = { SALT_ROUNDS, TOKEN_EXPIRY };
