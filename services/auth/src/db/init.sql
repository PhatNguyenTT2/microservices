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
-- user_id NULL = walk-in customer (không cần tài khoản đăng nhập)
-- DROP old schema (user_id PK, no address) — data is empty, safe to recreate
DROP TABLE IF EXISTS customer;
CREATE TABLE IF NOT EXISTS customer (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    user_id BIGINT REFERENCES user_account(id) ON DELETE SET NULL,
    full_name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    gender TEXT CHECK (gender IN ('Male', 'Female', 'Other')),
    dob DATE,
    total_spent NUMERIC DEFAULT 0,
    customer_type TEXT DEFAULT 'retail',
    is_active BOOLEAN NOT NULL DEFAULT TRUE
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