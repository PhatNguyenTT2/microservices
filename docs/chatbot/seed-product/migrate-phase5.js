/**
 * Phase 5 Schema Migration — ensemble_weights_history
 * Run once on Supabase to enable weight trend visualization.
 * 
 * Usage: node migrate-phase5.js
 *   Reads DATABASE_URL from ../../.env or environment variable
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

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
    console.error('❌ DATABASE_URL not set. Check .env file or set environment variable.');
    process.exit(1);
}

console.log('🔗 Connecting to:', dbUrl.replace(/:[^:@]+@/, ':***@'));

const pool = new Pool({
    connectionString: dbUrl,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

async function migrate() {
    try {
        console.log('Migrating Phase 5 tables...');

        await pool.query(`
            CREATE TABLE IF NOT EXISTS ensemble_weights_history (
                id BIGSERIAL PRIMARY KEY,
                store_id BIGINT NOT NULL,
                alpha NUMERIC NOT NULL,
                beta NUMERIC NOT NULL,
                gamma NUMERIC NOT NULL,
                delta NUMERIC NOT NULL,
                feedback_count INT DEFAULT 0,
                trigger_type TEXT DEFAULT 'nightly',
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_weight_history_store_date
                ON ensemble_weights_history(store_id, created_at DESC);
        `);

        // Seed initial row from current weights (so chart has at least 1 point)
        const { rows: current } = await pool.query(
            'SELECT store_id, alpha, beta, gamma, delta FROM ensemble_weights'
        );
        for (const row of current) {
            await pool.query(`
                INSERT INTO ensemble_weights_history
                    (store_id, alpha, beta, gamma, delta, feedback_count, trigger_type)
                VALUES ($1, $2, $3, $4, $5, 0, 'initial')
            `, [row.store_id, row.alpha, row.beta, row.gamma, row.delta]);
        }

        console.log(`✅ Migration OK — seeded ${current.length} initial history row(s)`);

        const { rows: check } = await pool.query(
            'SELECT COUNT(*)::int AS count FROM ensemble_weights_history'
        );
        console.log(`✅ ensemble_weights_history: ${check[0].count} rows`);

        await pool.end();
    } catch (err) {
        console.error('❌ Migration FAILED:', err.message);
        await pool.end();
        process.exit(1);
    }
}

migrate();
