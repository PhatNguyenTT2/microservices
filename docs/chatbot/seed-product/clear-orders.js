/**
 * Clear Orders Script — Xóa sạch toàn bộ dữ liệu đơn hàng và Apriori trước khi chạy mock-orders.js
 * 
 * Target tables: 
 * - sale_order (CASCADE xóa luôn sale_order_detail)
 * - co_purchase_stats (Xóa dữ liệu thống kê cũ của chatbot)
 * - product_order_frequency (Bảng mới của Phase 1 nếu có)
 * 
 * Chạy: cd microservices && node docs/chatbot/seed-product/clear-orders.js
 */
const { Pool } = require('pg');

// Khởi tạo kết nối tới Shared DB (nơi chứa order và chatbot tables)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function clearOrders() {
  const client = await pool.connect();
  console.log(`\n🧹 Bắt đầu xóa dữ liệu đơn hàng...`);
  console.log(`🔗 Database: ${pool.options.host || 'shared DB'}\n`);

  try {
    await client.query('BEGIN');

    // 1. Xóa toàn bộ dữ liệu Orders (Cascade sẽ tự xóa detail)
    console.log('1. Xóa bảng sale_order (và sale_order_detail)...');
    await client.query('TRUNCATE TABLE sale_order CASCADE');

    // 2. Xóa các tables thống kê của Chatbot / Apriori (để tính toán lại từ đầu)
    console.log('2. Xóa bảng co_purchase_stats (Chatbot dữ liệu mồi)...');
    await client.query('TRUNCATE TABLE co_purchase_stats CASCADE');

    // Nếu đã tạo bảng mới product_order_frequency cho Phase 1, xóa luôn
    const checkTableResult = await client.query(`
      SELECT to_regclass('public.product_order_frequency');
    `);
    if (checkTableResult.rows[0].to_regclass) {
      console.log('3. Xóa bảng product_order_frequency (Apriori Step 2)...');
      await client.query('TRUNCATE TABLE product_order_frequency CASCADE');
    }

    // 3. (Optional) Reset Outbox/SAGA events liên quan tới order để dọn dẹp log (Nâng cao)
    console.log('4. Dọn dẹp Outbox & SAGA processes liên quan order...');
    await client.query(`DELETE FROM outbox_events WHERE event_type LIKE 'order.%'`);
    await client.query(`DELETE FROM processed_events WHERE event_id LIKE 'order.%'`);

    await client.query('COMMIT');
    console.log('\n✅ DỌN DẸP THÀNH CÔNG! Database hiện tại đã trong trạng thái "Sạch" cho đơn hàng.\n');
    console.log('💡 Bây giờ bạn có thể an tâm chạy:');
    console.log('   node docs/chatbot/seed-product/mock-orders.js\n');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Lỗi khi dọn dẹp:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

clearOrders();  