-- ============================================================
-- Service 8: AI Chatbot — chatbot_db
-- Port: 3008
-- ============================================================

CREATE TABLE IF NOT EXISTS chat_session (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    user_id BIGINT NOT NULL,
    user_type TEXT NOT NULL DEFAULT 'customer'
        CHECK (user_type IN ('customer', 'employee')),
    store_id BIGINT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS chat_message (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    session_id BIGINT NOT NULL REFERENCES chat_session(id),
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    intent TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_session_user ON chat_session(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_session_active ON chat_session(is_active) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_chat_message_session ON chat_message(session_id);

-- ============================================================
-- RAG: pgvector + Full-text Search
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS product_knowledge_base (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,

    -- Cross-service references (no FK — different DB)
    product_id BIGINT NOT NULL,
    store_id BIGINT NOT NULL,

    -- Content & Embedding
    content TEXT NOT NULL,
    embedding VECTOR(768),
    fts_content TSVECTOR,

    -- Cached metadata (avoid cross-service queries)
    category_name TEXT,
    unit_price NUMERIC DEFAULT 0,
    is_in_stock BOOLEAN DEFAULT TRUE,
    quantity_on_shelf INT DEFAULT 0,

    last_synced_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (product_id, store_id)
);

-- HNSW index for vector similarity search (cosine)
CREATE INDEX IF NOT EXISTS idx_pkb_embedding
    ON product_knowledge_base USING hnsw (embedding vector_cosine_ops);

-- GIN index for full-text keyword search
CREATE INDEX IF NOT EXISTS idx_pkb_fts
    ON product_knowledge_base USING gin (fts_content);

-- B-Tree for metadata filtering
CREATE INDEX IF NOT EXISTS idx_pkb_store_stock
    ON product_knowledge_base(store_id, is_in_stock)
    WHERE is_in_stock = TRUE;

CREATE INDEX IF NOT EXISTS idx_pkb_product_store
    ON product_knowledge_base(product_id, store_id);

-- ============================================================
-- Co-purchase Statistics (from order.completed events)
-- ============================================================

CREATE TABLE IF NOT EXISTS co_purchase_stats (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    product_id_a BIGINT NOT NULL,
    product_id_b BIGINT NOT NULL,
    store_id BIGINT NOT NULL,
    co_purchase_count INT DEFAULT 1,
    last_updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (product_id_a, product_id_b, store_id)
);

CREATE INDEX IF NOT EXISTS idx_copurchase_lookup
    ON co_purchase_stats(product_id_a, store_id)
    WHERE co_purchase_count >= 3;

-- ============================================================
-- Event Idempotency (same pattern as inventory/order services)
-- ============================================================

CREATE TABLE IF NOT EXISTS processed_events (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    event_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    service_name TEXT NOT NULL DEFAULT 'chatbot-service',
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(event_id, service_name)
);

CREATE INDEX IF NOT EXISTS idx_processed_events_id ON processed_events(event_id);

-- ============================================================
-- MIGRATION: Apriori Metrics (Phase 1B)
-- Adds support, confidence, lift to co_purchase_stats
-- ============================================================

DO $$ BEGIN
    ALTER TABLE co_purchase_stats ADD COLUMN support NUMERIC DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE co_purchase_stats ADD COLUMN confidence_ab NUMERIC DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE co_purchase_stats ADD COLUMN confidence_ba NUMERIC DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE co_purchase_stats ADD COLUMN lift NUMERIC DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE co_purchase_stats ADD COLUMN total_orders INT DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Partial index: only rows with meaningful lift
CREATE INDEX IF NOT EXISTS idx_copurchase_lift
    ON co_purchase_stats(product_id_a, store_id)
    WHERE lift > 1;

-- Single-item order frequency (denominator for confidence)
CREATE TABLE IF NOT EXISTS product_order_frequency (
    product_id BIGINT NOT NULL,
    store_id BIGINT NOT NULL,
    order_count INT DEFAULT 0,
    last_computed_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (product_id, store_id)
);

-- ============================================================
-- Phase 2: Item-based Collaborative Filtering
-- ============================================================

-- User-item interaction matrix (implicit feedback from orders)
CREATE TABLE IF NOT EXISTS user_product_interaction (
    user_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    store_id BIGINT NOT NULL,
    purchase_count INT DEFAULT 0,
    total_quantity INT DEFAULT 0,
    last_purchased_at TIMESTAMPTZ,
    interaction_score NUMERIC DEFAULT 0,
    PRIMARY KEY (user_id, product_id, store_id)
);

CREATE INDEX IF NOT EXISTS idx_interaction_user
    ON user_product_interaction(user_id, store_id);

CREATE INDEX IF NOT EXISTS idx_interaction_product
    ON user_product_interaction(product_id, store_id);

-- Pre-computed item similarity (nightly batch — Adjusted Cosine)
CREATE TABLE IF NOT EXISTS item_similarity (
    item_a BIGINT NOT NULL,
    item_b BIGINT NOT NULL,
    store_id BIGINT NOT NULL,
    similarity NUMERIC NOT NULL,
    common_users INT DEFAULT 0,
    computed_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (item_a, item_b, store_id)
);

CREATE INDEX IF NOT EXISTS idx_item_sim_lookup
    ON item_similarity(item_a, store_id)
    WHERE similarity >= 0.3;

-- ============================================================
-- Phase 3: Hybrid Ensemble + Feedback Loop
-- ============================================================

-- Recommendation feedback (for adaptive weight learning)
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

-- Ensemble weight configuration (per store, tunable)
CREATE TABLE IF NOT EXISTS ensemble_weights (
    store_id BIGINT PRIMARY KEY,
    alpha NUMERIC DEFAULT 0.40,
    beta NUMERIC DEFAULT 0.25,
    gamma NUMERIC DEFAULT 0.25,
    delta NUMERIC DEFAULT 0.10,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Phase 5: Weight history log (for trend visualization in AI Dashboard)
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
