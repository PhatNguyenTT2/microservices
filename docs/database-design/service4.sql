-- ==========================================
-- 1. CẤU HÌNH BẢO MẬT (Cho Service 1)
-- ==========================================
CREATE TABLE security_settings (
    id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    max_failed_attempts INT NOT NULL DEFAULT 5,
    lock_duration_minutes INT NOT NULL DEFAULT 30,
    updated_by BIGINT, -- user_account.id
    updated_at TIMESTAMPTZ DEFAULT NOW() -- Với settings, thời gian rất quan trọng
);

-- ==========================================
-- 2. CẤU HÌNH KHUYẾN MÃI & CHIẾT KHẤU (Cho Service 2 & 3)
-- ==========================================
CREATE TABLE sales_settings (
    id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    
    -- Fresh Product Promotion
    auto_promotion_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    promotion_start_time TIME, -- Dùng kiểu TIME thay vì TEXT để validation tốt hơn
    promotion_discount_percentage NUMERIC NOT NULL DEFAULT 0,

    -- Customer Discount Rates
    discount_retail NUMERIC NOT NULL DEFAULT 5,
    discount_wholesale NUMERIC NOT NULL DEFAULT 10,
    discount_vip NUMERIC NOT NULL DEFAULT 15,
    
    updated_by BIGINT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================================
-- 3. LỊCH SỬ THAY ĐỔI (Dùng JSONB là cực chuẩn)
-- ==========================================
CREATE TABLE settings_history (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    setting_type TEXT NOT NULL, -- 'security', 'sales'
    old_value JSONB NOT NULL,
    new_value JSONB NOT NULL,
    changed_by BIGINT, -- user_account.id
    change_reason TEXT,
    changed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_settings_history_type ON settings_history(setting_type);