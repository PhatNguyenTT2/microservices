const { Pool } = require('/app/shared/node_modules/pg');

async function migrate() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query('ALTER TABLE sale_order ALTER COLUMN customer_id DROP NOT NULL');
    console.log('SUCCESS: customer_id is now nullable (walk-in customers supported)');
  } catch (err) {
    console.error('ERROR:', err.message);
  } finally {
    await pool.end();
  }
}

migrate();
