const fs = require('fs');
const { Pool } = require('/app/shared/node_modules/pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    const sql = fs.readFileSync('/tmp/inventory-seed.sql', 'utf8');
    
    await pool.query(sql);
    console.log('Seed completed successfully!');

    const counts = await pool.query(`
        SELECT 'warehouse_block' AS tbl, COUNT(*)::int AS cnt FROM warehouse_block WHERE store_id = 1
        UNION ALL SELECT 'location', COUNT(*)::int FROM location
        UNION ALL SELECT 'product_batch', COUNT(*)::int FROM product_batch WHERE store_id = 1
        UNION ALL SELECT 'inventory_item', COUNT(*)::int FROM inventory_item
        UNION ALL SELECT 'inventory_movement', COUNT(*)::int FROM inventory_movement
    `);
    counts.rows.forEach(row => console.log(row.tbl + ': ' + row.cnt));

    const summary = await pool.query(`
        SELECT COUNT(*)::int AS products, SUM(total_on_hand)::int AS total_hand, SUM(total_on_shelf)::int AS total_shelf
        FROM v_product_inventory WHERE store_id = 1
    `);
    console.log('View summary:', JSON.stringify(summary.rows[0]));

    await pool.end();
}

run().catch(e => {
    console.error('ERROR:', e.message);
    pool.end();
    process.exit(1);
});
