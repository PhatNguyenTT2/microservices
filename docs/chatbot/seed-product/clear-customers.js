/**
 * Clear Customers Script — Xóa sạch toàn bộ dữ liệu Customer
 * 
 * Target tables (trên Shared DB):
 * - customer (Truncate)
 * - user_account (Xóa toàn bộ user có role là 'Customer')
 * 
 * Chạy: cd microservices && node docs/chatbot/seed-product/clear-customers.js
 */
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function clearCustomers() {
  const client = await pool.connect();
  console.log(`\n🧹 Bắt đầu dọn dẹp dữ liệu Customer...`);
  console.log(`🔗 Database: ${pool.options.host || 'shared DB'}\n`);

  try {
    await client.query('BEGIN');

    // 1. Xóa bảng customer (Profile)
    console.log('1. Xóa bảng customer (CASCADE)...');
    await client.query('TRUNCATE TABLE customer CASCADE');

    // 2. Xóa các account liên kết với role Customer
    console.log('2. Xóa các tài khoản (user_account) có role là Customer...');
    const deleteUsersResult = await client.query(`
      DELETE FROM user_account 
      WHERE role_id = (SELECT id FROM role WHERE name = 'Customer')
    `);

    console.log(`   -> Đã xóa ${deleteUsersResult.rowCount} tài khoản đăng nhập của Customer.`);

    await client.query('COMMIT');
    console.log('\n✅ DỌN DẸP THÀNH CÔNG! Toàn bộ dữ liệu khách hàng (Profile + Account) đã được xóa sạch.\n');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Lỗi khi dọn dẹp:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

clearCustomers();
