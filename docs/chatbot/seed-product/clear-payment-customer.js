/**
 * Clear Payment & Customer Script — Dọn dẹp module Payment và Customer
 * 
 * Target tables (trên Shared DB):
 * - payment, vnpay_transaction (Xóa sạch)
 * - customer (Truncate)
 * 
 * Chạy: cd microservices && node docs/chatbot/seed-product/clear-payment-customer.js
 */
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function clearPaymentCustomer() {
  const client = await pool.connect();
  console.log(`\n🧹 Bắt đầu dọn dẹp dữ liệu Payment & Customer...`);
  console.log(`🔗 Database: ${pool.options.host || 'shared DB'}\n`);

  try {
    await client.query('BEGIN');

    // 1. Payment Services
    console.log('1. Xóa bảng payment và vnpay_transaction (CASCADE)...');
    await client.query('TRUNCATE TABLE payment CASCADE');
    await client.query('TRUNCATE TABLE vnpay_transaction CASCADE');

    // (Optional) Xóa outbox/processed events của payment để dọn dẹp message rác
    await client.query(`DELETE FROM outbox_events WHERE event_type LIKE 'payment.%'`);
    await client.query(`DELETE FROM processed_events WHERE event_id LIKE 'payment.%'`);

    // 2. Auth Service (Customer)
    console.log('2. Xóa bảng customer (CASCADE)...');
    await client.query('TRUNCATE TABLE customer CASCADE');

    await client.query('COMMIT');
    console.log('\n✅ DỌN DẸP THÀNH CÔNG! Dữ liệu Payment và Customer đã sạch hoàn toàn.\n');
    console.log('ℹ️  POS default-guest vẫn hoạt động bình thường (virtual object, không phụ thuộc DB).\n');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Lỗi khi dọn dẹp:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

clearPaymentCustomer();
