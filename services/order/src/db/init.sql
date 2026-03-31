-- ============================================================
-- SERVICE 3: ORDER (order_db)
-- Multi-Tenancy: Thêm store_id vào sale_order
-- Bỏ Payment (đã tách ra Service 7)
-- ============================================================

CREATE TABLE IF NOT EXISTS sale_order (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    store_id BIGINT NOT NULL,                 -- ID Cửa hàng nơi phát sinh đơn (Multi-Tenancy)
    customer_id BIGINT NOT NULL,              -- ID Khách hàng (Chain-level)
    created_by BIGINT NOT NULL,               -- ID Nhân viên
    order_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Giao nhận
    delivery_type TEXT NOT NULL DEFAULT 'pickup' 
        CHECK (delivery_type IN ('delivery', 'pickup')),
    address TEXT,                             
    shipping_fee NUMERIC NOT NULL DEFAULT 0,
    
    -- Tài chính
    discount_percentage NUMERIC NOT NULL DEFAULT 0,
    total_amount NUMERIC NOT NULL DEFAULT 0,
    
    -- Trạng thái
    payment_status TEXT NOT NULL DEFAULT 'pending' 
        CHECK (payment_status IN ('pending', 'partial', 'paid', 'failed', 'refunded')),
    status TEXT NOT NULL DEFAULT 'draft' 
        CHECK (status IN ('draft', 'completed', 'shipping', 'delivered', 'cancelled', 'refunded'))
);

-- Indexes 
CREATE INDEX IF NOT EXISTS idx_sale_order_store ON sale_order(store_id);  -- QUAN TRỌNG CHO TENANCY
CREATE INDEX IF NOT EXISTS idx_sale_order_customer ON sale_order(customer_id);
CREATE INDEX IF NOT EXISTS idx_sale_order_status ON sale_order(status);
CREATE INDEX IF NOT EXISTS idx_sale_order_date ON sale_order(order_date);

CREATE TABLE IF NOT EXISTS sale_order_detail (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    order_id BIGINT NOT NULL REFERENCES sale_order(id) ON DELETE CASCADE,
    
    -- Snapshot dữ liệu từ Service 2 (Catalog) và Service 6 (Inventory)
    product_name TEXT NOT NULL,               
    batch_id BIGINT NOT NULL,                 -- Thuộc Service 6
    
    quantity INT NOT NULL DEFAULT 1 CHECK (quantity >= 1),
    unit_price NUMERIC NOT NULL CHECK (unit_price >= 0),
    total_price NUMERIC NOT NULL CHECK (total_price >= 0)
);

CREATE INDEX IF NOT EXISTS idx_order_detail_order_id ON sale_order_detail(order_id);

-- ==========================================
-- SAGA: IDEMPOTENCY TABLE
-- ==========================================
CREATE TABLE IF NOT EXISTS processed_events (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    event_id TEXT UNIQUE NOT NULL,
    event_type TEXT NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_processed_events_id ON processed_events(event_id);

-- ==========================================
-- MIGRATION: Add 'reserved' status for Saga reserve flow
-- ==========================================
DO $$ BEGIN
    ALTER TABLE sale_order DROP CONSTRAINT IF EXISTS sale_order_status_check;
    ALTER TABLE sale_order ADD CONSTRAINT sale_order_status_check
        CHECK (status IN ('draft', 'pending', 'reserved', 'completed', 'shipping', 'delivered', 'cancelled', 'refunded'));
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
