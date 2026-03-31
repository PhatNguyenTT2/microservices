-- ============================================================
-- SEED DATA: Permissions + Super Admin role
-- Run after init.sql
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
  ('view_notifications', 'View Notifications')
ON CONFLICT (code) DO NOTHING;

-- 2. Create Super Admin role
INSERT INTO role (name, description) VALUES
  ('Super Admin', 'Full system access - all permissions')
ON CONFLICT (name) DO NOTHING;

-- 3. Assign ALL permissions to Super Admin
INSERT INTO role_permission (role_id, permission_id)
SELECT r.id, p.id
FROM role r
CROSS JOIN permission p
WHERE r.name = 'Super Admin'
ON CONFLICT DO NOTHING;

-- 4. Create default roles (optional, for reference)
INSERT INTO role (name, description) VALUES
  ('Store Manager', 'Store-level management'),
  ('Cashier', 'POS operations only'),
  ('Inventory Staff', 'Inventory management'),
  ('Customer', 'Customer self-service')
ON CONFLICT (name) DO NOTHING;
