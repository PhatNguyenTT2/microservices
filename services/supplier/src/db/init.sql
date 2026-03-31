-- ============================================================
-- SERVICE 5: SUPPLIER (supplier_db)
-- Multi-Tenancy: Thêm store_id vào purchase_order
-- ============================================================

CREATE TABLE IF NOT EXISTS supplier (
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

CREATE INDEX IF NOT EXISTS idx_supplier_name ON supplier(company_name);
CREATE INDEX IF NOT EXISTS idx_supplier_debt ON supplier(current_debt) WHERE current_debt > 0;

CREATE TABLE IF NOT EXISTS purchase_order (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    store_id BIGINT NOT NULL,                 -- ID Cửa hàng nhập hàng (Multi-Tenancy)
    supplier_id BIGINT NOT NULL REFERENCES supplier(id),
    order_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    received_date TIMESTAMPTZ,
    shipping_fee NUMERIC NOT NULL DEFAULT 0,
    discount_percentage NUMERIC NOT NULL DEFAULT 0,
    total_price NUMERIC NOT NULL DEFAULT 0,
    
    status TEXT NOT NULL DEFAULT 'draft' 
        CHECK (status IN ('draft', 'approved', 'received', 'cancelled')),
    
    payment_status TEXT NOT NULL DEFAULT 'unpaid' 
        CHECK (payment_status IN ('unpaid', 'partial', 'paid')),
        
    created_by BIGINT,
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_po_store_id ON purchase_order(store_id); -- QUAN TRỌNG CHO TENANCY
CREATE INDEX IF NOT EXISTS idx_po_supplier_id ON purchase_order(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_status ON purchase_order(status);

CREATE TABLE IF NOT EXISTS purchase_order_detail (
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

CREATE INDEX IF NOT EXISTS idx_po_detail_po_id ON purchase_order_detail(po_id);

-- ============================================================
-- SEED DATA: Suppliers
-- ============================================================
INSERT INTO supplier (company_name, phone, address, account_number, payment_terms, credit_limit, current_debt, is_active)
VALUES
  ('Vinamilk', '028-38998899', '10 Tân Trào, Q.7, TP.HCM', '9704001234567890', 'net30', 500000000, 120000000, TRUE),
  ('Masan Consumer', '024-62553666', '9/F Vincom, 72 Lê Thánh Tôn, Q.1, TP.HCM', '9704009876543210', 'net60', 800000000, 350000000, TRUE),
  ('Acecook Việt Nam', '028-37980093', 'Lô II-3 CN, KCN Tân Bình, TP.HCM', '1234567890123456', 'net30', 300000000, 50000000, TRUE),
  ('Kinh Đô', '028-38445566', '141 Nguyễn Du, Q.1, TP.HCM', '9876543210987654', 'net30', 250000000, 0, TRUE),
  ('Coca-Cola Việt Nam', '028-35128888', 'KCN Mỹ Phước, Bến Cát, Bình Dương', '1111222233334444', 'net60', 600000000, 200000000, TRUE),
  ('PepsiCo Việt Nam', '028-38121212', 'KCN Biên Hòa 2, Đồng Nai', '5555666677778888', 'net60', 550000000, 100000000, TRUE),
  ('Unilever Việt Nam', '028-54131000', '156 Nguyễn Lương Bằng, Q.7, TP.HCM', '9999000011112222', 'net90', 1000000000, 450000000, TRUE),
  ('P&G Việt Nam', '028-38233100', '58 Nguyễn Đình Chiểu, Q.1, TP.HCM', '3333444455556666', 'net90', 700000000, 0, TRUE),
  ('Nestlé Việt Nam', '028-38106666', 'KCN AMATA, Biên Hòa, Đồng Nai', '7777888899990000', 'net30', 400000000, 180000000, TRUE),
  ('TH True Milk', '0238-3868888', 'Nghĩa Đàn, Nghệ An', '1234509876543210', 'cod', 200000000, 0, TRUE),
  ('Vissan', '028-38161616', '420 Nơ Trang Long, Q.Bình Thạnh, TP.HCM', '6543210987654321', 'net15', 150000000, 30000000, TRUE),
  ('Nutifood', '028-39971199', '281-283 Hoàng Diệu, Q.4, TP.HCM', '1357924680135792', 'net30', 350000000, 290000000, TRUE),
  ('Dabaco', '0222-3862286', 'KCN Tiên Sơn, Từ Sơn, Bắc Ninh', '2468013579246801', 'net15', 100000000, 0, FALSE),
  ('CJ Việt Nam', '028-35127777', 'KCN Hiệp Phước, Nhà Bè, TP.HCM', '9517538642097531', 'net30', 250000000, 80000000, TRUE),
  ('Saigon Food', '028-38401400', '100 Nguyễn Văn Trỗi, Q.Phú Nhuận, TP.HCM', '7531908642975310', 'cod', 80000000, 0, TRUE)
ON CONFLICT DO NOTHING;

-- (No PO seed data — created dynamically via API)