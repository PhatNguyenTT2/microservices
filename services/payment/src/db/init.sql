-- ============================================================
-- SERVICE 7: PAYMENT (payment_db)
-- Multi-Tenancy: Thêm store_id vào payment
-- ============================================================

CREATE TABLE IF NOT EXISTS payment (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    store_id BIGINT NOT NULL,                 -- Giao dịch thuộc cửa hàng nào
    amount NUMERIC NOT NULL CHECK (amount > 0),
    method TEXT NOT NULL CHECK (method IN ('cash', 'card', 'bank_transfer', 'vnpay')),
    status TEXT NOT NULL DEFAULT 'pending' 
        CHECK (status IN ('pending', 'completed', 'cancelled', 'refunded')),
    
    -- Liên kết đa hình sang Service 3 (Order) hoặc Service 5 (PO)
    reference_type TEXT NOT NULL CHECK (reference_type IN ('SaleOrder', 'PurchaseOrder')),
    reference_id BIGINT NOT NULL,
    
    payment_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by BIGINT,                        -- NV thu tiền
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_payment_store_id ON payment(store_id);
CREATE INDEX IF NOT EXISTS idx_payment_ref ON payment(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_payment_status ON payment(status);

CREATE TABLE IF NOT EXISTS vnpay_transaction (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    payment_id BIGINT REFERENCES payment(id) ON DELETE SET NULL,
    reference_id BIGINT NOT NULL,             -- ID của Order hoặc PO
    
    vnp_txn_ref TEXT UNIQUE NOT NULL,         
    vnp_transaction_no TEXT,                  
    
    vnp_amount BIGINT NOT NULL,               
    vnp_response_code TEXT,
    vnp_transaction_status TEXT,
    vnp_bank_code TEXT,
    vnp_bank_tran_no TEXT,
    vnp_card_type TEXT,
    vnp_pay_date TEXT,
    vnp_order_info TEXT,
    vnp_ip_addr TEXT,
    vnp_locale TEXT,
    vnp_secure_hash TEXT,
    
    status TEXT NOT NULL DEFAULT 'pending' 
        CHECK (status IN ('pending', 'success', 'failed', 'expired')),
    payment_url TEXT,
    ipn_verified BOOLEAN NOT NULL DEFAULT FALSE,
    return_url_accessed BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_vnpay_payment_id ON vnpay_transaction(payment_id);
CREATE INDEX IF NOT EXISTS idx_vnpay_status ON vnpay_transaction(status);

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
