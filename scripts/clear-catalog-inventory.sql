-- ============================================================
-- CLEAR CATALOG + INVENTORY DATA
-- Run on OLD DB (oapxjyjz... / ap-northeast-2)
-- ============================================================
-- 
-- PURPOSE: Clear all catalog and inventory data before 
-- migrating catalog to its own dedicated database.
--
-- ORDER MATTERS: Inventory tables first (FK dependencies),
-- then Catalog tables.
-- ============================================================

-- ==========================================
-- PHASE A: Clear Inventory data
-- (depends on product_id from catalog via product_batch)
-- ==========================================

-- 1. Stock Out details → references product_batch
TRUNCATE TABLE stock_out_detail CASCADE;
TRUNCATE TABLE stock_out_order CASCADE;

-- 2. Inventory movements → references inventory_item
TRUNCATE TABLE inventory_movement CASCADE;

-- 3. Inventory items → references product_batch, location
TRUNCATE TABLE inventory_item CASCADE;

-- 4. Product batches → references product_id (soft ref to catalog)
TRUNCATE TABLE product_batch CASCADE;

-- ==========================================
-- PHASE B: Clear Catalog data from OLD DB
-- (cleanup orphaned tables after migration)
-- ==========================================

-- 1. Price history → references product
TRUNCATE TABLE product_price_history CASCADE;

-- 2. Products → references category
TRUNCATE TABLE product CASCADE;

-- 3. Categories (root + subcategories)
TRUNCATE TABLE category CASCADE;

-- ==========================================
-- VERIFICATION: Check all tables are empty
-- ==========================================
SELECT 'stock_out_detail' AS table_name, COUNT(*) AS row_count FROM stock_out_detail
UNION ALL SELECT 'stock_out_order', COUNT(*) FROM stock_out_order
UNION ALL SELECT 'inventory_movement', COUNT(*) FROM inventory_movement
UNION ALL SELECT 'inventory_item', COUNT(*) FROM inventory_item
UNION ALL SELECT 'product_batch', COUNT(*) FROM product_batch
UNION ALL SELECT 'product_price_history', COUNT(*) FROM product_price_history
UNION ALL SELECT 'product', COUNT(*) FROM product
UNION ALL SELECT 'category', COUNT(*) FROM category;
