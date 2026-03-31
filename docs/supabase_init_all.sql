-- ============================================================
-- SERVICE 1: AUTH & IDENTITY (auth_db)
-- Multi-Tenancy: Thêm bảng `store`, thêm `store_id` vào `employee`
-- ============================================================

-- ==========================================
-- 1. QUẢN LÝ CỬA HÀNG (STORE) - TENANCY ROOT
-- ==========================================

CREATE TABLE IF NOT EXISTS store (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    name TEXT NOT NULL,
    address TEXT,
    phone TEXT,
    manager_id BIGINT,              -- Sẽ là FK tới user_account (circular, handle ở app)
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- 2. NHÓM BẢNG PHÂN QUYỀN (RBAC) - Chain-wide
-- ==========================================

CREATE TABLE IF NOT EXISTS permission (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    code TEXT UNIQUE NOT NULL, 
    description TEXT
);

CREATE TABLE IF NOT EXISTS role (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    name TEXT UNIQUE NOT NULL,
    description TEXT
);

CREATE TABLE IF NOT EXISTS role_permission (
    role_id BIGINT REFERENCES role(id) ON DELETE CASCADE,
    permission_id BIGINT REFERENCES permission(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- ==========================================
-- 3. NHÓM BẢNG ĐỊNH DANH (IDENTITY) - Chain-wide
-- ==========================================

CREATE TABLE IF NOT EXISTS user_account (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role_id BIGINT NOT NULL REFERENCES role(id),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_account_email ON user_account(email);
CREATE INDEX IF NOT EXISTS idx_user_account_role ON user_account(role_id);

-- ==========================================
-- 4. NHÓM BẢNG HỒ SƠ (PROFILES - SHARED PK)
-- ==========================================

-- Bảng Employee: Thêm store_id (Thuộc 1 cửa hàng)
CREATE TABLE IF NOT EXISTS employee (
    user_id BIGINT PRIMARY KEY REFERENCES user_account(id) ON DELETE CASCADE,
    store_id BIGINT REFERENCES store(id) ON DELETE SET NULL, -- Null nếu là nhân viên HQ
    full_name TEXT NOT NULL,
    address TEXT,
    phone TEXT,
    gender TEXT CHECK (gender IN ('Male', 'Female', 'Other')),
    dob DATE
);
CREATE INDEX IF NOT EXISTS idx_employee_store_id ON employee(store_id);

-- Bảng Customer: Chain-level (Không thuộc cửa hàng nào)
CREATE TABLE IF NOT EXISTS customer (
    user_id BIGINT PRIMARY KEY REFERENCES user_account(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    phone TEXT,
    gender TEXT CHECK (gender IN ('Male', 'Female', 'Other')),
    dob DATE,
    total_spent NUMERIC DEFAULT 0,
    customer_type TEXT
);

-- ==========================================
-- 5. NHÓM BẢNG BẢO MẬT & PHIÊN LÀM VIỆC - Chain-wide
-- ==========================================

CREATE TABLE IF NOT EXISTS auth_tokens (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    user_id BIGINT NOT NULL REFERENCES user_account(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    type TEXT CHECK (type IN ('REFRESH', 'PASSWORD_RESET')) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS pos_auth (
    user_id BIGINT PRIMARY KEY REFERENCES user_account(id) ON DELETE CASCADE,
    pin_hash TEXT NOT NULL,
    failed_attempts INT DEFAULT 0,
    locked_until TIMESTAMPTZ,
    is_enabled BOOLEAN DEFAULT TRUE,
    last_login TIMESTAMPTZ
);

-- Bổ sung reference cho store sau khi có đủ bảng
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_store_manager'
  ) THEN
    ALTER TABLE store ADD CONSTRAINT fk_store_manager
      FOREIGN KEY (manager_id) REFERENCES user_account(id) ON DELETE SET NULL;
  END IF;
END
$$;
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

-- No seed data — data is managed via API
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

-- ============================================================
-- Service 4: Settings Service
-- Database initialization script
-- ============================================================

-- 1. SECURITY SETTINGS (Singleton)
CREATE TABLE IF NOT EXISTS security_settings (
    id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    max_failed_attempts INT NOT NULL DEFAULT 5,
    lock_duration_minutes INT NOT NULL DEFAULT 30,
    updated_by BIGINT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed Default Security Settings
INSERT INTO security_settings (id, max_failed_attempts, lock_duration_minutes)
VALUES (1, 5, 30)
ON CONFLICT (id) DO NOTHING;

-- 2. SALES SETTINGS (Singleton)
CREATE TABLE IF NOT EXISTS sales_settings (
    id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    auto_promotion_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    promotion_start_time TIME,
    promotion_discount_percentage NUMERIC NOT NULL DEFAULT 0,
    discount_retail NUMERIC NOT NULL DEFAULT 0,
    discount_wholesale NUMERIC NOT NULL DEFAULT 5,
    discount_vip NUMERIC NOT NULL DEFAULT 10,
    updated_by BIGINT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed Default Sales Settings
INSERT INTO sales_settings (id, auto_promotion_enabled, promotion_start_time, promotion_discount_percentage, discount_retail, discount_wholesale, discount_vip)
VALUES (1, false, '18:00:00', 20, 0, 5, 10)
ON CONFLICT (id) DO NOTHING;

-- 3. SETTINGS HISTORY (Audit Log)
CREATE TABLE IF NOT EXISTS settings_history (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    setting_type TEXT NOT NULL CHECK (setting_type IN ('security', 'sales')),
    old_value JSONB NOT NULL,
    new_value JSONB NOT NULL,
    changed_by BIGINT,
    change_reason TEXT,
    changed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_settings_history_type ON settings_history(setting_type);
CREATE INDEX IF NOT EXISTS idx_settings_history_date ON settings_history(changed_at);

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
    location_id BIGINT NOT NULL REFERENCES location(id),
    quantity_on_hand INT NOT NULL DEFAULT 0,
    quantity_on_shelf INT NOT NULL DEFAULT 0,
    quantity_reserved INT NOT NULL DEFAULT 0,
    UNIQUE (product_batch_id, location_id)
);

CREATE INDEX IF NOT EXISTS idx_inv_item_batch_id ON inventory_item(product_batch_id);

CREATE TABLE IF NOT EXISTS inventory_movement (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    inventory_item_id BIGINT NOT NULL REFERENCES inventory_item(id) ON DELETE CASCADE,
    movement_type TEXT NOT NULL CHECK (movement_type IN ('in', 'out', 'adjustment', 'transfer')),
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

