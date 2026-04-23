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

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
    console.error('❌ DATABASE_URL not set. Check .env file or set environment variable.');
    process.exit(1);
}

const pool = new Pool({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false }
});

async function run() {
    console.log('🔗 Connecting to:', dbUrl.replace(/:[^:]*@/, ':***@'));
    
    // Read the SQL file from the auth service db folder
    const sqlPath = path.resolve(__dirname, '..', '..', '..', 'services', 'auth', 'src', 'db', 'customer-seed.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    
    console.log('Running customer seed...');
    await pool.query(sql);
    
    console.log('Fixing member to Guest...');
    const updateRes = await pool.query("UPDATE customer SET customer_type = 'Guest' WHERE customer_type = 'member'");
    console.log(`Updated ${updateRes.rowCount} records to Guest`);
    
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
