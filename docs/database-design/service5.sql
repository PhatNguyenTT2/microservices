-- ============================================================
-- SERVICE 5: SUPPLIER (supplier_db)
-- Multi-Tenancy: Thêm store_id vào purchase_order
-- ============================================================

CREATE TABLE supplier (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    company_name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    account_number TEXT,
    
    payment_terms TEXT NOT NULL DEFAULT 'cod' 
        CHECK (payment_terms IN ('cod', 'net15', 'net30', 'net60', 'net90')),
        
    credit_limit NUMERIC NOT NULL DEFAULT 0,
    current_debt NUMERIC NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX idx_supplier_name ON supplier(company_name);
CREATE INDEX idx_supplier_debt ON supplier(current_debt) WHERE current_debt > 0;

CREATE TABLE purchase_order (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    store_id BIGINT NOT NULL,                 -- ID Cửa hàng nhập hàng (Multi-Tenancy)
    supplier_id BIGINT NOT NULL REFERENCES supplier(id),
    order_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    received_date TIMESTAMPTZ,
    
    shipping_fee NUMERIC NOT NULL DEFAULT 0,
    discount_percentage NUMERIC NOT NULL DEFAULT 0,
    total_price NUMERIC NOT NULL DEFAULT 0,
    
    status TEXT NOT NULL DEFAULT 'draft' 
        CHECK (status IN ('draft', 'pending', 'approved', 'received', 'cancelled')),
    
    payment_status TEXT NOT NULL DEFAULT 'unpaid' 
        CHECK (payment_status IN ('unpaid', 'partial', 'paid')),
        
    created_by BIGINT,
    notes TEXT
);

CREATE INDEX idx_po_store_id ON purchase_order(store_id); -- QUAN TRỌNG CHO TENANCY
CREATE INDEX idx_po_supplier_id ON purchase_order(supplier_id);
CREATE INDEX idx_po_status ON purchase_order(status);

CREATE TABLE purchase_order_detail (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    po_id BIGINT NOT NULL REFERENCES purchase_order(id) ON DELETE CASCADE,
    
    product_id BIGINT NOT NULL,               -- ID từ Service 2 (Catalog)
    product_name TEXT NOT NULL,               
    
    batch_id BIGINT,                          -- ID lô được tạo ở Service 6
    
    quantity INT NOT NULL DEFAULT 1 CHECK (quantity >= 1),
    cost_price NUMERIC NOT NULL CHECK (cost_price >= 0),
    total_price NUMERIC NOT NULL CHECK (total_price >= 0),
    
    UNIQUE (po_id, product_id)
);

CREATE INDEX idx_po_detail_po_id ON purchase_order_detail(po_id);