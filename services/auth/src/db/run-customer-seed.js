const fs = require('fs');
const { Pool } = require('/app/shared/node_modules/pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    console.log('Connecting to Supabase...');
    const sql = fs.readFileSync('/tmp/customer-seed.sql', 'utf8');
    
    await pool.query(sql);
    console.log('✅ Seed completed successfully!');

    const result = await pool.query(`SELECT COUNT(*)::int as count FROM customer`);
    console.log(`Total customers in DB: ${result.rows[0].count}`);

    const sample = await pool.query(`SELECT id, full_name, phone, address, gender, dob, total_spent, customer_type FROM customer ORDER BY id DESC LIMIT 3`);
    console.log('Sample newly created customers:', JSON.stringify(sample.rows, null, 2));

    await pool.end();
}

run().catch(e => {
    console.error('ERROR:', e.message);
    pool.end();
    process.exit(1);
});
