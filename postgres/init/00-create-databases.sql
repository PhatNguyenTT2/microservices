-- ============================================================
-- PostgreSQL Init: Create all 8 databases (Multi-Tenant Architecture)
-- Thứ tự: Hạ tầng → Master Data → Inbound → Kho → Outbound → Tài chính → AI
-- ============================================================

-- Service 1: Auth & Identity (:3001)
-- auth_db is created by POSTGRES_DB env var

-- Service 2: Catalog (:3002)
CREATE DATABASE catalog_db;

-- Service 3: Order (:3003)
CREATE DATABASE order_db;

-- Service 4: Settings (:3004)
CREATE DATABASE settings_db;

-- Service 5: Supplier (:3005)
CREATE DATABASE supplier_db;

-- Service 6: Inventory (:3006)
CREATE DATABASE inventory_db;

-- Service 7: Payment (:3007)
CREATE DATABASE payment_db;

-- Service 8: AI Chatbot (:3008)
CREATE DATABASE chatbot_db;
