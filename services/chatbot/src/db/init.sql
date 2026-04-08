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
