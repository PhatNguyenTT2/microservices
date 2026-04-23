/**
 * Phase 3 Schema Migration — Run once on Supabase
 * Creates: recommendation_feedback, ensemble_weights
 */
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function migrate() {
    try {
        console.log('Migrating Phase 3 tables...');

        await pool.query(`
            CREATE TABLE IF NOT EXISTS recommendation_feedback (
                id BIGSERIAL PRIMARY KEY,
                user_id BIGINT,
                product_id BIGINT,
                store_id BIGINT NOT NULL,
                source TEXT NOT NULL,
                action TEXT NOT NULL,
                session_id TEXT,
                recommendation_score NUMERIC,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_feedback_user
                ON recommendation_feedback(user_id, store_id, created_at DESC);

            CREATE INDEX IF NOT EXISTS idx_feedback_source_action
                ON recommendation_feedback(source, action, store_id);

            CREATE TABLE IF NOT EXISTS ensemble_weights (
                store_id BIGINT PRIMARY KEY,
                alpha NUMERIC DEFAULT 0.40,
                beta NUMERIC DEFAULT 0.25,
                gamma NUMERIC DEFAULT 0.25,
                delta NUMERIC DEFAULT 0.10,
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );

            INSERT INTO ensemble_weights (store_id) VALUES (1)
            ON CONFLICT (store_id) DO NOTHING;
        `);

        const { rows } = await pool.query('SELECT * FROM ensemble_weights');
        console.log('✅ Migration OK — ensemble_weights:', JSON.stringify(rows));

        const { rows: fbCheck } = await pool.query(`
            SELECT column_name FROM information_schema.columns
            WHERE table_name = 'recommendation_feedback'
            ORDER BY ordinal_position
        `);
        console.log('✅ recommendation_feedback columns:', fbCheck.map(r => r.column_name).join(', '));

        await pool.end();
    } catch (err) {
        console.error('❌ Migration FAILED:', err.message);
        await pool.end();
        process.exit(1);
    }
}

migrate();
