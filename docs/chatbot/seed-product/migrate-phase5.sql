-- Phase 5: AI Dashboard Migration
-- Run this SQL directly in Supabase SQL Editor (Dashboard → SQL Editor → New Query)

-- 1. Create history table
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

-- 2. Seed initial row from current weights
INSERT INTO ensemble_weights_history (store_id, alpha, beta, gamma, delta, feedback_count, trigger_type)
SELECT store_id, alpha, beta, gamma, delta, 0, 'initial'
FROM ensemble_weights;

-- 3. Verify
SELECT * FROM ensemble_weights_history;
