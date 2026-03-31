-- ============================================================
-- SERVICE 6: INVENTORY (inventory_db)
-- Multi-Tenancy: Thêm store_id vào batch, warehouse, stock_out
-- ============================================================

-- ==========================================
-- 1. QUẢN LÝ LÔ HÀNG (BATCHING & PRICING LOCAL)
-- ==========================================

CREATE TABLE product_batch (
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

CREATE INDEX idx_batch_store_id ON product_batch(store_id);
CREATE INDEX idx_batch_product_id ON product_batch(product_id);
CREATE INDEX idx_batch_expiry ON product_batch(expiry_date);

-- ==========================================
-- 2. QUẢN LÝ KHO BÃI (WAREHOUSE)
-- ==========================================

CREATE TABLE warehouse_block (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    store_id BIGINT NOT NULL,                 -- Thuộc Cửa hàng (Multi-Tenancy)
    name TEXT NOT NULL,
    rows INT NOT NULL CHECK (rows BETWEEN 1 AND 20),
    cols INT NOT NULL CHECK (cols BETWEEN 1 AND 20),
    column_gaps INT[] DEFAULT '{}',
    UNIQUE (store_id, name)
);

CREATE INDEX idx_warehouse_store_id ON warehouse_block(store_id);

CREATE TABLE location (
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

CREATE TABLE inventory_item (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    product_batch_id BIGINT NOT NULL REFERENCES product_batch(id) ON DELETE CASCADE,
    location_id BIGINT NOT NULL REFERENCES location(id),
    quantity_on_hand INT NOT NULL DEFAULT 0,
    quantity_on_shelf INT NOT NULL DEFAULT 0,
    quantity_reserved INT NOT NULL DEFAULT 0,
    UNIQUE (product_batch_id, location_id)
);

CREATE INDEX idx_inv_item_batch_id ON inventory_item(product_batch_id);

CREATE TABLE inventory_movement (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    inventory_item_id BIGINT NOT NULL REFERENCES inventory_item(id) ON DELETE CASCADE,
    movement_type TEXT NOT NULL CHECK (movement_type IN ('in', 'out', 'adjustment', 'transfer')),
    quantity INT NOT NULL,
    reason TEXT,
    moved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    performed_by BIGINT                      -- FK sang Service 1
);

CREATE INDEX idx_inv_movement_item_id ON inventory_movement(inventory_item_id);

-- ==========================================
-- 4. XUẤT KHO (STOCK OUT)
-- ==========================================

CREATE TABLE stock_out_order (
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

CREATE INDEX idx_soo_store_id ON stock_out_order(store_id);
CREATE INDEX idx_soo_status ON stock_out_order(status);

CREATE TABLE stock_out_detail (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    so_id BIGINT NOT NULL REFERENCES stock_out_order(id) ON DELETE CASCADE,
    batch_id BIGINT NOT NULL REFERENCES product_batch(id),
    quantity INT NOT NULL CHECK (quantity >= 1),
    unit_price NUMERIC NOT NULL DEFAULT 0,   
    total_price NUMERIC NOT NULL DEFAULT 0   
);

CREATE INDEX idx_so_detail_order_id ON stock_out_detail(so_id);

-- ==========================================
-- 5. VIEW TỔNG HỢP TỒN KHO 
-- ==========================================

CREATE OR REPLACE VIEW v_product_inventory AS
SELECT
    pb.store_id,                              -- Nhóm theo cửa hàng
    pb.product_id,
    COALESCE(SUM(ii.quantity_on_hand), 0) AS total_on_hand,
    COALESCE(SUM(ii.quantity_on_shelf), 0) AS total_on_shelf,
    COALESCE(SUM(ii.quantity_reserved), 0) AS total_reserved,
    COALESCE(SUM(ii.quantity_on_hand + ii.quantity_on_shelf - ii.quantity_reserved), 0) AS total_available
FROM
    product_batch pb
    LEFT JOIN inventory_item ii ON pb.id = ii.product_batch_id
GROUP BY
    pb.store_id, pb.product_id;
