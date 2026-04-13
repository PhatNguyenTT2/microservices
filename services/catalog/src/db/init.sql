-- ============================================================
-- SERVICE 2: CATALOG (catalog_db)
-- Multi-Tenancy: Centralized (Không có store_id)
-- ============================================================

CREATE TABLE IF NOT EXISTS category (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    parent_id BIGINT REFERENCES category(id) ON DELETE CASCADE,  -- NULL = root category
    name TEXT NOT NULL,
    image_url TEXT,
    description TEXT,
    sort_order INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_category_parent_id ON category(parent_id);

CREATE TABLE IF NOT EXISTS product (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    category_id BIGINT NOT NULL REFERENCES category(id),
    name TEXT NOT NULL,
    image_url TEXT,
    unit_price NUMERIC NOT NULL DEFAULT 0, -- Giá niêm yết chung toàn chuỗi
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    vendor TEXT
);

-- Index cho Catalog
CREATE INDEX IF NOT EXISTS idx_product_category_id ON product(category_id);
CREATE INDEX IF NOT EXISTS idx_product_name ON product(name); -- Hỗ trợ tìm kiếm

CREATE TABLE IF NOT EXISTS product_price_history (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    product_id BIGINT NOT NULL REFERENCES product(id) ON DELETE CASCADE,
    old_price NUMERIC NOT NULL,
    new_price NUMERIC NOT NULL,
    reason TEXT,
    changed_by BIGINT,                       -- FK sang Service 1
    changed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_history_product_id ON product_price_history(product_id);

-- ==========================================
-- MIGRATION: Add is_perishable flag to category
-- Replaces hard-coded 'fresh' string matching
-- ==========================================
DO $$ BEGIN
    ALTER TABLE category ADD COLUMN is_perishable BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- No seed data — data is managed via API