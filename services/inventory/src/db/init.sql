-- ============================================================
-- SERVICE 6: INVENTORY (inventory_db)
-- Multi-Tenancy: Thêm store_id vào batch, warehouse, stock_out
-- ============================================================

-- ==========================================
-- 1. QUẢN LÝ LÔ HÀNG (BATCHING & PRICING LOCAL)
-- ==========================================

CREATE TABLE IF NOT EXISTS product_batch (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    store_id BIGINT NOT NULL,                 -- Thuộc Cửa hàng (Multi-Tenancy)
    product_id BIGINT NOT NULL,               -- ID từ Service 2 (Catalog)
    cost_price NUMERIC NOT NULL,             
    unit_price NUMERIC NOT NULL,              -- Giá bán đè của lô (nếu cần khác giá Catalog)
    discount_percentage NUMERIC DEFAULT 0,
    quantity INT NOT NULL CHECK (quantity >= 0), 
    mfg_date DATE,
    expiry_date DATE,
    status TEXT NOT NULL DEFAULT 'active' 
        CHECK (status IN ('active', 'expired', 'sold_out')),
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_batch_store_id ON product_batch(store_id);
CREATE INDEX IF NOT EXISTS idx_batch_product_id ON product_batch(product_id);
CREATE INDEX IF NOT EXISTS idx_batch_expiry ON product_batch(expiry_date);

-- ==========================================
-- 2. QUẢN LÝ KHO BÃI (WAREHOUSE)
-- ==========================================

CREATE TABLE IF NOT EXISTS warehouse_block (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    store_id BIGINT NOT NULL,                 -- Thuộc Cửa hàng (Multi-Tenancy)
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'warehouse'
        CHECK (type IN ('warehouse', 'store_shelf')),
    rows INT NOT NULL CHECK (rows BETWEEN 1 AND 20),
    cols INT NOT NULL CHECK (cols BETWEEN 1 AND 20),
    column_gaps INT[] DEFAULT '{}',
    UNIQUE (store_id, name)
);

CREATE INDEX IF NOT EXISTS idx_warehouse_store_id ON warehouse_block(store_id);

CREATE TABLE IF NOT EXISTS location (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    block_id BIGINT NOT NULL REFERENCES warehouse_block(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    position INT NOT NULL,
    max_capacity INT NOT NULL DEFAULT 100,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (block_id, name),
    UNIQUE (block_id, position)
);

-- ==========================================
-- 3. TỒN KHO CHI TIẾT (INVENTORY)
-- ==========================================

CREATE TABLE IF NOT EXISTS inventory_item (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    product_batch_id BIGINT NOT NULL REFERENCES product_batch(id) ON DELETE CASCADE,
    location_id BIGINT REFERENCES location(id),   -- NULL = "assign later"
    quantity_on_hand INT NOT NULL DEFAULT 0,
    quantity_on_shelf INT NOT NULL DEFAULT 0,
    quantity_reserved INT NOT NULL DEFAULT 0,
    reorder_point INT NOT NULL DEFAULT 10
);

-- Partial unique: one item per batch+location (when location is known)
CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_item_batch_location 
    ON inventory_item(product_batch_id, location_id) WHERE location_id IS NOT NULL;
-- Partial unique: one "unlocated" item per batch
CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_item_batch_no_location 
    ON inventory_item(product_batch_id) WHERE location_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_inv_item_batch_id ON inventory_item(product_batch_id);

CREATE TABLE IF NOT EXISTS inventory_movement (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    inventory_item_id BIGINT NOT NULL REFERENCES inventory_item(id) ON DELETE CASCADE,
    movement_type TEXT NOT NULL CHECK (movement_type IN ('in', 'out', 'adjustment', 'transfer', 'reserve', 'release')),
    quantity INT NOT NULL,
    reason TEXT,
    moved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    performed_by BIGINT                      -- FK sang Service 1
);

CREATE INDEX IF NOT EXISTS idx_inv_movement_item_id ON inventory_movement(inventory_item_id);

-- ==========================================
-- 4. XUẤT KHO (STOCK OUT)
-- ==========================================

CREATE TABLE IF NOT EXISTS stock_out_order (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    store_id BIGINT NOT NULL,                 -- Thuộc Cửa hàng (Multi-Tenancy)
    order_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_date TIMESTAMPTZ,
    reason TEXT NOT NULL DEFAULT 'sales' 
        CHECK (reason IN ('sales', 'transfer', 'damage', 'expired', 'return_to_supplier', 'internal_use', 'other')),
    destination TEXT,
    status TEXT NOT NULL DEFAULT 'draft' 
        CHECK (status IN ('draft', 'pending', 'completed', 'cancelled')),
    total_price NUMERIC NOT NULL DEFAULT 0,
    created_by BIGINT NOT NULL               -- FK sang Service 1
);

CREATE INDEX IF NOT EXISTS idx_soo_store_id ON stock_out_order(store_id);
CREATE INDEX IF NOT EXISTS idx_soo_status ON stock_out_order(status);

CREATE TABLE IF NOT EXISTS stock_out_detail (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    so_id BIGINT NOT NULL REFERENCES stock_out_order(id) ON DELETE CASCADE,
    batch_id BIGINT NOT NULL REFERENCES product_batch(id),
    quantity INT NOT NULL CHECK (quantity >= 1),
    unit_price NUMERIC NOT NULL DEFAULT 0,   
    total_price NUMERIC NOT NULL DEFAULT 0   
);

CREATE INDEX IF NOT EXISTS idx_so_detail_order_id ON stock_out_detail(so_id);

-- ==========================================
-- 5. VIEW TỔNG HỢP TỒN KHO 
-- ==========================================

CREATE OR REPLACE VIEW v_product_inventory AS
SELECT
    pb.store_id,
    pb.product_id,
    COALESCE(SUM(ii.quantity_on_hand), 0) AS total_on_hand,
    COALESCE(SUM(ii.quantity_on_shelf), 0) AS total_on_shelf,
    COALESCE(SUM(ii.quantity_reserved), 0) AS total_reserved,
    COALESCE(SUM(ii.quantity_on_hand + ii.quantity_on_shelf - ii.quantity_reserved), 0) AS total_available,
    COALESCE(MIN(ii.reorder_point), 10) AS reorder_point
FROM
    product_batch pb
    LEFT JOIN inventory_item ii ON pb.id = ii.product_batch_id
GROUP BY
    pb.store_id, pb.product_id;

-- ==========================================
-- 6. SAGA: IDEMPOTENCY TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS processed_events (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    event_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    service_name TEXT NOT NULL DEFAULT 'unknown',
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(event_id, service_name)
);
CREATE INDEX IF NOT EXISTS idx_processed_events_id ON processed_events(event_id);

-- ==========================================
-- MIGRATION: Update movement_type CHECK for reserve/release on existing tables
-- ==========================================
DO $$ BEGIN
    ALTER TABLE inventory_movement DROP CONSTRAINT IF EXISTS inventory_movement_movement_type_check;
    ALTER TABLE inventory_movement ADD CONSTRAINT inventory_movement_movement_type_check
        CHECK (movement_type IN ('in', 'out', 'adjustment', 'transfer', 'reserve', 'release'));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ==========================================
-- SAGA: TRANSACTIONAL OUTBOX
-- ==========================================
CREATE TABLE IF NOT EXISTS outbox_events (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_outbox_unpublished ON outbox_events(id) WHERE published_at IS NULL;

-- ==========================================
-- MIGRATION: Add type column to warehouse_block
-- ==========================================
DO $$ BEGIN
    ALTER TABLE warehouse_block ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'warehouse'
        CHECK (type IN ('warehouse', 'store_shelf'));
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ==========================================
-- MIGRATION: Add service_name to outbox for shared-DB isolation
-- ==========================================
DO $$ BEGIN
    ALTER TABLE outbox_events ADD COLUMN service_name TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS idx_outbox_service ON outbox_events(service_name) WHERE published_at IS NULL;

-- ==========================================
-- MIGRATION: Fix processed_events for shared-DB isolation
-- ==========================================
DO $$ BEGIN
    ALTER TABLE processed_events ADD COLUMN service_name TEXT NOT NULL DEFAULT 'unknown';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE processed_events DROP CONSTRAINT IF EXISTS processed_events_event_id_key;
    ALTER TABLE processed_events ADD CONSTRAINT processed_events_event_service_unique UNIQUE (event_id, service_name);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;