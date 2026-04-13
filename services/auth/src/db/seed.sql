-- ============================================================
-- SEED DATA: Permissions + Roles + Role-Permission assignments
-- Run after init.sql (idempotent — uses ON CONFLICT)
-- ============================================================

-- 1. Insert all system permissions
INSERT INTO permission (code, description) VALUES
  ('view_dashboard', 'View Dashboard'),
  ('manage_products', 'Manage Products'),
  ('manage_categories', 'Manage Categories'),
  ('manage_orders', 'Manage Orders'),
  ('manage_customers', 'Manage Customers'),
  ('manage_suppliers', 'Manage Suppliers'),
  ('manage_employees', 'Manage Employees'),
  ('manage_POS', 'Manage POS'),
  ('manage_roles', 'Manage Roles'),
  ('manage_inventory', 'Manage Inventory'),
  ('view_reports', 'View Reports'),
  ('manage_payments', 'Manage Payments'),
  ('manage_settings', 'Manage Settings'),
  ('view_notifications', 'View Notifications'),
  ('pos_access', 'POS Access - Can use POS terminal with PIN')
ON CONFLICT (code) DO NOTHING;

-- 2. Create 5 system roles
INSERT INTO role (name, description) VALUES
  ('Super Admin', 'Full system access - all permissions'),
  ('Store Manager', 'Store-level management - products, orders, inventory, customers, suppliers'),
  ('Cashier', 'POS operations - process sales and payments'),
  ('Store Admin', 'Store administration - manage employees, roles, and system settings'),
  ('Customer', 'Customer self-service - view only')
ON CONFLICT (name) DO NOTHING;

-- 3. Super Admin → ALL permissions
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r
CROSS JOIN permission p
WHERE r.name = 'Super Admin'
ON CONFLICT DO NOTHING;

-- 4. Store Manager → store management + POS access
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r
CROSS JOIN permission p
WHERE r.name = 'Store Manager'
  AND p.code IN (
    'view_dashboard', 'manage_products', 'manage_categories',
    'manage_orders', 'manage_customers', 'manage_suppliers',
    'manage_inventory', 'view_reports', 'manage_payments',
    'view_notifications', 'pos_access', 'manage_settings'
  )
ON CONFLICT DO NOTHING;

-- 5. Cashier → POS operations only
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r
CROSS JOIN permission p
WHERE r.name = 'Cashier'
  AND p.code IN (
    'view_dashboard', 'manage_orders', 'manage_payments',
    'view_notifications', 'pos_access'
  )
ON CONFLICT DO NOTHING;

-- 6. Store Admin → admin management (no POS access)
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r
CROSS JOIN permission p
WHERE r.name = 'Store Admin'
  AND p.code IN (
    'view_dashboard', 'manage_employees', 'manage_roles',
    'manage_settings', 'view_reports', 'view_notifications'
  )
ON CONFLICT DO NOTHING;

-- 7. Customer → view only
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r
CROSS JOIN permission p
WHERE r.name = 'Customer'
  AND p.code IN ('view_dashboard')
ON CONFLICT DO NOTHING;