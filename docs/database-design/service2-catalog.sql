-- ============================================================
-- SERVICE 2: CATALOG (catalog_db)
-- Multi-Tenancy: Centralized (Không có store_id)
-- ============================================================

CREATE TABLE category (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    name TEXT NOT NULL,
    image_url TEXT,
    description TEXT
);

CREATE TABLE product (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    category_id BIGINT NOT NULL REFERENCES category(id),
    name TEXT NOT NULL,
    image_url TEXT,
    unit_price NUMERIC NOT NULL DEFAULT 0, -- Giá niêm yết chung toàn chuỗi
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    vendor TEXT
);

-- Index cho Catalog
CREATE INDEX idx_product_category_id ON product(category_id);
CREATE INDEX idx_product_name ON product(name); -- Hỗ trợ tìm kiếm

CREATE TABLE product_price_history (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    product_id BIGINT NOT NULL REFERENCES product(id) ON DELETE CASCADE,
    old_price NUMERIC NOT NULL,
    new_price NUMERIC NOT NULL,
    reason TEXT,
    changed_by BIGINT,                       -- FK sang Service 1
    changed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_price_history_product_id ON product_price_history(product_id);
