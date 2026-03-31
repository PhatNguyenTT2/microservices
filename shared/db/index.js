const { Pool } = require('pg');
const logger = require('../common/logger');

/**
 * Create a PostgreSQL connection pool.
 * Supports 2 modes:
 *   1. DATABASE_URL (cloud: Supabase, Neon, etc.)
 *   2. POSTGRES_HOST/PORT/USER/PASSWORD (local Docker)
 */
function createPool(dbName) {
  const databaseUrl = process.env.DATABASE_URL;

  let poolConfig;

  if (databaseUrl) {
    // URL mode: supports both cloud (with SSL) and local Docker (without SSL)
    const url = new URL(databaseUrl);
    const useSSL = process.env.DB_SSL === 'true';

    // Cloud mode (SSL): use URL database (all tables in one DB)
    // Local mode: use per-service dbName override
    const database = useSSL
      ? url.pathname.slice(1)
      : (dbName || url.pathname.slice(1));

    poolConfig = {
      user: url.username,
      password: decodeURIComponent(url.password),
      host: url.hostname,
      port: parseInt(url.port || '5432', 10),
      database,
      ssl: useSSL ? { rejectUnauthorized: false } : false,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000
    };
    logger.info({ host: url.hostname, db: database, ssl: useSSL }, 'PostgreSQL: using URL connection');
  } else {
    // Local Docker mode
    poolConfig = {
      user: process.env.POSTGRES_USER || 'posmart',
      password: process.env.POSTGRES_PASSWORD || 'posmart_secret',
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
      database: dbName || process.env.POSTGRES_DB,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    };
    logger.info({ host: poolConfig.host, db: poolConfig.database }, 'PostgreSQL: using local connection');
  }

  const pool = new Pool(poolConfig);

  pool.on('error', (err) => {
    logger.error({ err, db: poolConfig.database }, 'Unexpected PostgreSQL pool error');
  });

  return pool;
}

/**
 * Run raw SQL against a pool.
 */
async function runSQL(pool, sql) {
  const client = await pool.connect();
  try {
    await client.query(sql);
  } finally {
    client.release();
  }
}

/**
 * Health check: verify pool can connect.
 */
async function checkHealth(pool) {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT NOW()');
    return { status: 'ok', timestamp: result.rows[0].now };
  } finally {
    client.release();
  }
}

/**
 * Graceful shutdown.
 */
async function closePool(pool) {
  await pool.end();
  logger.info('PostgreSQL pool closed');
}

module.exports = { createPool, runSQL, checkHealth, closePool };
