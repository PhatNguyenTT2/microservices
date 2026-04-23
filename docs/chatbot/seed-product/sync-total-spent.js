/**
 * Sync customer.total_spent from delivered/completed orders in sale_order table.
 * Both tables are in the same Supabase PostgreSQL database.
 * 
 * Usage: node sync-total-spent.js
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Load .env from microservices root
const envPath = path.resolve(__dirname, '..', '..', '..', '.env');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.substring(0, eqIdx).trim();
        const val = trimmed.substring(eqIdx + 1).trim();
        if (!process.env[key]) process.env[key] = val;
    }
    console.log('📄 Loaded .env from:', envPath);
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    console.log('🔗 Connecting...');

    // Check if there are any orders
    const orderCheck = await pool.query(`SELECT COUNT(*)::int AS cnt FROM sale_order`);
    console.log(`Total orders in DB: ${orderCheck.rows[0].cnt}`);

    // Calculate total_spent per customer from delivered orders
    const result = await pool.query(`
        UPDATE customer c
        SET total_spent = COALESCE(sub.spent, 0)
        FROM (
            SELECT customer_id, SUM(total_amount) AS spent
            FROM sale_order
            WHERE status IN ('delivered', 'completed')
              AND payment_status IN ('paid', 'partial')
            GROUP BY customer_id
        ) sub
        WHERE c.id = sub.customer_id
        RETURNING c.id, c.full_name, c.total_spent
    `);

    if (result.rowCount > 0) {
        console.log(`✅ Updated total_spent for ${result.rowCount} customers:`);
        result.rows.forEach(r => console.log(`  - #${r.id} ${r.full_name}: ${r.total_spent}`));
    } else {
        console.log('ℹ️  No delivered/paid orders found. total_spent stays at 0 for all customers.');
    }

    // Show summary
    const summary = await pool.query(`
        SELECT customer_type, COUNT(*)::int AS cnt, SUM(total_spent)::int AS total
        FROM customer GROUP BY customer_type ORDER BY customer_type
    `);
    console.log('\nCustomer summary:');
    summary.rows.forEach(r => console.log(`  ${r.customer_type}: ${r.cnt} customers, total spent: ${r.total || 0}`));

    await pool.end();
}

run().catch(e => {
    console.error('ERROR:', e.message);
    pool.end();
    process.exit(1);
});
