/**
 * Clear Catalog + Inventory data on OLD shared DB
 * Run once before catalog DB migration
 */
const { Pool } = require('pg');

const OLD_DB_URL = 'postgresql://postgres.oapxjyjzvnwouztokiqb:601235016138C39@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres';

async function clearData() {
  const pool = new Pool({
    connectionString: OLD_DB_URL,
    ssl: { rejectUnauthorized: false },
    max: 2
  });

  const client = await pool.connect();
  
  try {
    console.log('🔗 Connected to OLD DB (ap-northeast-2)');
    console.log('');

    // Phase A: Clear Inventory data
    console.log('=== PHASE A: Clearing Inventory data ===');
    
    const inventoryTables = [
      'stock_out_detail',
      'stock_out_order', 
      'inventory_movement',
      'inventory_item',
      'product_batch'
    ];

    for (const table of inventoryTables) {
      try {
        const result = await client.query(`TRUNCATE TABLE ${table} CASCADE`);
        console.log(`  ✅ TRUNCATED: ${table}`);
      } catch (err) {
        if (err.message.includes('does not exist')) {
          console.log(`  ⚠️  SKIPPED: ${table} (table does not exist)`);
        } else {
          throw err;
        }
      }
    }

    // Phase B: Clear Catalog data
    console.log('');
    console.log('=== PHASE B: Clearing Catalog data ===');
    
    const catalogTables = [
      'product_price_history',
      'product',
      'category'
    ];

    for (const table of catalogTables) {
      try {
        await client.query(`TRUNCATE TABLE ${table} CASCADE`);
        console.log(`  ✅ TRUNCATED: ${table}`);
      } catch (err) {
        if (err.message.includes('does not exist')) {
          console.log(`  ⚠️  SKIPPED: ${table} (table does not exist)`);
        } else {
          throw err;
        }
      }
    }

    // Verification
    console.log('');
    console.log('=== VERIFICATION ===');
    
    const allTables = [...inventoryTables, ...catalogTables];
    for (const table of allTables) {
      try {
        const { rows } = await client.query(`SELECT COUNT(*)::int AS cnt FROM ${table}`);
        const count = rows[0].cnt;
        const icon = count === 0 ? '✅' : '❌';
        console.log(`  ${icon} ${table}: ${count} rows`);
      } catch (err) {
        console.log(`  ⚠️  ${table}: cannot verify (${err.message})`);
      }
    }

    console.log('');
    console.log('🎉 Data clearing complete!');

  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

clearData();
