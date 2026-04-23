-- ============================================================
-- INVENTORY SEED DATA - DỰ ÁN SIÊU THỊ MINI
-- File: services/inventory/src/db/inventory-seed.sql
-- Target DB: inventory_db (store_id = 1)
-- ============================================================
-- Luồng tạo:
--   1. warehouse_block (2 blocks)
--   2. location (60 per block = 120 total)
--   3. product_batch (60 batches, 1 per product)
--   4. inventory_item (120 items, 2 per batch: warehouse + shelf)
--   5. inventory_movement (120 movements, 1 per inventory_item)
-- ============================================================

BEGIN;

-- ==========================================
-- CLEANUP: Xóa dữ liệu cũ (nếu seed lại)
-- ==========================================
TRUNCATE inventory_movement CASCADE;
TRUNCATE inventory_item CASCADE;
TRUNCATE product_batch CASCADE;
TRUNCATE location CASCADE;
TRUNCATE warehouse_block CASCADE;

-- ==========================================
-- 1. WAREHOUSE BLOCKS (store_id = 1)
-- ==========================================
INSERT INTO warehouse_block (id, store_id, name, type, rows, cols)
OVERRIDING SYSTEM VALUE
VALUES
  (1, 1, 'Kho chính',     'warehouse',    6, 10),
  (2, 1, 'Kệ trưng bày',  'store_shelf',  6, 10);

SELECT setval(pg_get_serial_sequence('warehouse_block', 'id'), 2);

-- ==========================================
-- 2. LOCATIONS (60 per block = 120 total)
-- Naming: W-A01..W-F10 (warehouse), S-A01..S-F10 (shelf)
-- Position: 1..60 per block
-- ==========================================
INSERT INTO location (id, block_id, name, position, max_capacity, is_active)
OVERRIDING SYSTEM VALUE
SELECT
    pos AS id,                                          -- 1..60 for warehouse
    1 AS block_id,                                      -- Block 1 = Kho chính
    'W-' || CHR(64 + ((pos - 1) / 10 + 1))             -- W-A, W-B, ... W-F
        || LPAD(((pos - 1) % 10 + 1)::TEXT, 2, '0')    -- 01..10
    AS name,
    pos AS position,
    500 AS max_capacity,
    TRUE AS is_active
FROM generate_series(1, 60) AS pos;

INSERT INTO location (id, block_id, name, position, max_capacity, is_active)
OVERRIDING SYSTEM VALUE
SELECT
    60 + pos AS id,                                     -- 61..120 for shelf
    2 AS block_id,                                      -- Block 2 = Kệ trưng bày
    'S-' || CHR(64 + ((pos - 1) / 10 + 1))             -- S-A, S-B, ... S-F
        || LPAD(((pos - 1) % 10 + 1)::TEXT, 2, '0')    -- 01..10
    AS name,
    pos AS position,
    500 AS max_capacity,
    TRUE AS is_active
FROM generate_series(1, 60) AS pos;

SELECT setval(pg_get_serial_sequence('location', 'id'), 120);

-- ==========================================
-- 3. PRODUCT BATCHES (60 records)
-- cost_price = catalog.unit_price × 0.9 (giá nhập)
-- unit_price = catalog.unit_price (giá bán)
-- quantity = 500, mfg = 2026-01-01, exp = 2029-01-01
-- ==========================================
-- CTE chứa catalog_price cho 60 sản phẩm
WITH catalog_prices (product_id, catalog_price) AS (
    VALUES
        (1,  125000), (2,   18000), (3,   15000), (4,   16000), (5,   12000),
        (6,   55000), (7,   22000), (8,   33000), (9,  385000), (10,  35000),
        (11,  20000), (12,   4500), (13, 115000), (14,   6000), (15,   8000),
        (16,   9500), (17,  19500), (18, 395000), (19,   9000), (20,  12000),
        (21,  85000), (22,  16000), (23,  25000), (24,  30000), (25,  28000),
        (26, 250000), (27,  95000), (28,  85000), (29, 165000), (30, 125000),
        (31,  98000), (32,  95000), (33,  65000), (34,  85000), (35,  34000),
        (36,  28000), (37,  42000), (38,   6000), (39,  12000), (40,  10000),
        (41,  12000), (42, 185000), (43, 875000), (44, 110000), (45,  45000),
        (46,  35000), (47,  48000), (48, 125000), (49,  32000), (50,  55000),
        (51,  15000), (52,  38000), (53,  33000), (54,  25000), (55, 135000),
        (56,  28000), (57,  15000), (58, 145000), (59,  95000), (60,  42000)
)
INSERT INTO product_batch (id, store_id, product_id, cost_price, unit_price, quantity, mfg_date, expiry_date, status, notes)
OVERRIDING SYSTEM VALUE
SELECT
    cp.product_id AS id,                                -- batch_id = product_id (1:1)
    1 AS store_id,
    cp.product_id,
    ROUND(cp.catalog_price * 0.9) AS cost_price,       -- Giá nhập = 90% giá catalog
    cp.catalog_price AS unit_price,                     -- Giá bán = giá catalog
    500 AS quantity,
    '2026-01-01'::DATE AS mfg_date,
    '2029-01-01'::DATE AS expiry_date,
    'active' AS status,
    'Initial stock - system seed' AS notes
FROM catalog_prices cp
ORDER BY cp.product_id;

SELECT setval(pg_get_serial_sequence('product_batch', 'id'), 60);

-- ==========================================
-- 4. INVENTORY ITEMS (120 records = 2 per batch)
-- Record A: Warehouse location → on_hand=200, on_shelf=0
-- Record B: Shelf location     → on_hand=0, on_shelf=300
-- ==========================================

-- 4A. Warehouse items (id 1..60)
INSERT INTO inventory_item (id, product_batch_id, location_id, quantity_on_hand, quantity_on_shelf, quantity_reserved, reorder_point)
OVERRIDING SYSTEM VALUE
SELECT
    pid AS id,
    pid AS product_batch_id,    -- batch_id = product_id
    pid AS location_id,         -- warehouse location 1..60
    200 AS quantity_on_hand,
    0   AS quantity_on_shelf,
    0   AS quantity_reserved,
    10  AS reorder_point
FROM generate_series(1, 60) AS pid;

-- 4B. Shelf items (id 61..120)
INSERT INTO inventory_item (id, product_batch_id, location_id, quantity_on_hand, quantity_on_shelf, quantity_reserved, reorder_point)
OVERRIDING SYSTEM VALUE
SELECT
    60 + pid AS id,
    pid AS product_batch_id,    -- same batch
    60 + pid AS location_id,    -- shelf location 61..120
    0   AS quantity_on_hand,
    300 AS quantity_on_shelf,
    0   AS quantity_reserved,
    10  AS reorder_point
FROM generate_series(1, 60) AS pid;

SELECT setval(pg_get_serial_sequence('inventory_item', 'id'), 120);

-- ==========================================
-- 5. INVENTORY MOVEMENTS (120 records)
-- 1 movement per inventory_item (type='in')
-- ==========================================

-- 5A. Warehouse movements (id 1..60)
INSERT INTO inventory_movement (id, inventory_item_id, movement_type, quantity, reason, moved_at, performed_by)
OVERRIDING SYSTEM VALUE
SELECT
    pid AS id,
    pid AS inventory_item_id,       -- warehouse item 1..60
    'in' AS movement_type,
    200 AS quantity,
    'initial_stock | Kho chính' AS reason,
    '2026-01-01 08:00:00+07'::TIMESTAMPTZ AS moved_at,
    1 AS performed_by               -- admin user
FROM generate_series(1, 60) AS pid;

-- 5B. Shelf movements (id 61..120)
INSERT INTO inventory_movement (id, inventory_item_id, movement_type, quantity, reason, moved_at, performed_by)
OVERRIDING SYSTEM VALUE
SELECT
    60 + pid AS id,
    60 + pid AS inventory_item_id,  -- shelf item 61..120
    'in' AS movement_type,
    300 AS quantity,
    'initial_stock | Kệ trưng bày' AS reason,
    '2026-01-01 08:00:00+07'::TIMESTAMPTZ AS moved_at,
    1 AS performed_by               -- admin user
FROM generate_series(1, 60) AS pid;

SELECT setval(pg_get_serial_sequence('inventory_movement', 'id'), 120);

-- ==========================================
-- VERIFICATION QUERIES (run after seed)
-- ==========================================
-- SELECT 'warehouse_block' AS tbl, COUNT(*) FROM warehouse_block WHERE store_id = 1
-- UNION ALL SELECT 'location', COUNT(*) FROM location
-- UNION ALL SELECT 'product_batch', COUNT(*) FROM product_batch WHERE store_id = 1
-- UNION ALL SELECT 'inventory_item', COUNT(*) FROM inventory_item
-- UNION ALL SELECT 'inventory_movement', COUNT(*) FROM inventory_movement;
-- Expected: 2, 120, 60, 120, 120

-- SELECT COUNT(*) AS products, SUM(total_on_hand) AS total_hand, SUM(total_on_shelf) AS total_shelf
-- FROM v_product_inventory WHERE store_id = 1;
-- Expected: 60, 12000, 18000

COMMIT;
