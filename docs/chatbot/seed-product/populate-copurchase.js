/**
 * Populate Co-Purchase Stats — Tạo dữ liệu co-purchase trực tiếp cho Chatbot Apriori
 * 
 * ⚠ QUAN TRỌNG — TẠI SAO CẦN SCRIPT NÀY:
 * mock-orders.js insert trực tiếp vào DB, BYPASS hoàn toàn pipeline:
 *   Order Service → outbox → RabbitMQ → Chatbot.handleOrderCompleted()
 * 
 * ⚡ PERFORMANCE:
 * v1 bị lỗi treo >1h vì 3500+ individual SQL queries qua remote Supabase.
 * v2 (hiện tại) dùng:
 *   - 1 query đọc ALL order details
 *   - In-memory pair aggregation (O(N) — instant)
 *   - 1 batch INSERT duy nhất
 * 
 * Chạy SAU mock-orders.js:
 *   cd microservices && node docs/chatbot/seed-product/populate-copurchase.js
 */
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Product name → ID mapping (reverse lookup từ seed.sql)
const NAME_TO_ID = {
  'Ba chỉ bò Mỹ thái lát mỏng khay 500g': 1,
  'Nấm kim châm Hàn Quốc gói 150g': 2,
  'Rau muống VietGAP bó 500g': 3,
  'Gia vị nêm sẵn lẩu Thái Barona 80g': 4,
  'Bún tươi Ba Khánh gói 500g': 5,
  'Cá viên chiên xâu tôm viên Vissan 500g': 6,
  'Bánh mì Sandwich lạt Kinh Đô 275g': 7,
  'Lốc 4 hộp Sữa tươi Vinamilk không đường 180ml': 8,
  'Thùng 48 hộp Sữa tươi Vinamilk không đường 180ml': 9,
  'Trứng gà sạch V.Food hộp 10 quả': 10,
  'Xúc xích heo tiệt trùng Vissan gói 4 cây': 11,
  'Mì Hảo Hảo hương vị tôm chua cay 75g': 12,
  'Thùng 30 gói mì Hảo Hảo tôm chua cay': 13,
  'Mì xào khô Indomie vị sườn đặc biệt 85g': 14,
  'Phở bò Vifon gói 80g': 15,
  'Miến dong Phú Hương sườn heo': 16,
  'Bia Heineken Silver lon 330ml': 17,
  'Thùng 24 lon bia Tiger Bạc 330ml': 18,
  'Nước ngọt Coca-Cola vị nguyên bản chai 390ml': 19,
  "Snack khoai tây Lay's vị Tự nhiên 52g": 20,
  'Khô gà lá chanh G kitchen hũ 200g': 21,
  'Cải thìa mỡ VietGAP 500g': 22,
  'Cà chua mận đỏ Đà Lạt 500g': 23,
  'Hành tây vàng loại 1 kg': 24,
  'Chuối già Nam Mỹ nải 1kg': 25,
  'Cherry đỏ Mỹ size 9.5 Hộp 500g': 26,
  'Thịt sườn non heo chuẩn C.P 500g': 27,
  'Thịt ba rọi heo rút sườn 500g': 28,
  'Thăn ngoại bò Úc Hokubee cắt bít tết 250g': 29,
  'Tôm sú sinh thái lột vỏ đông lạnh 250g': 30,
  'Mực ống làm sạch khay 300g': 31,
  'Chả lụa heo G Kitchen đòn 500g': 32,
  'Há cảo tôm thịt mini Cầu Tre 500g': 33,
  'Xúc xích xông khói phô mai vòng CP 500g': 34,
  'Lốc 4 hộp Sữa tươi TH True Milk có đường 180ml': 35,
  'Lốc 4 hộp Sữa chua nha đam Vinamilk 100g': 36,
  'Phô mai Bò Lúc Lắc hộp 8 miếng 120g': 37,
  'Nước khoáng thiên nhiên La Vie chai 500ml': 38,
  'Nước tinh khiết Aquafina chai 1.5L': 39,
  'Trà Ô Long Tea+ Plus chai 455ml': 40,
  'Nước tăng lực Red Bull lon 250ml': 41,
  'Gạo thơm ST25 lúa tôm Ông Cua túi 5kg': 42,
  'Bao Gạo đặc sản ST25 Sóc Trăng 25kg': 43,
  'Gạo thơm Lài Miên túi 5kg': 44,
  'Nấm hương khô Tây Bắc gói 100g': 45,
  'Đậu đen xanh lòng hạt nhỏ 500g': 46,
  'Dầu ăn thực vật Tường An chai 1L': 47,
  'Dầu đậu nành Simply chai 2L': 48,
  'Nước mắm Nam Ngư 11 độ đạm chai 750ml': 49,
  'Nước mắm cá cơm Hưng Thịnh 35 độ đạm chai 620ml': 50,
  'Nước tương Chinsu tỏi ớt chai 250ml': 51,
  'Hạt nêm Knorr từ thịt thăn xương ống gói 400g': 52,
  'Bột ngọt Ajinomoto gói 454g': 53,
  'Đường tinh luyện Biên Hòa bịch 1kg': 54,
  'Bánh quy bơ Danisa hộp thiếc 454g': 55,
  'Bánh xốp phô mai Nabati hộp 150g': 56,
  'Kẹo mút Chupa Chups hương trái cây gói 10 que': 57,
  'Bánh mì hoa cúc Harrys Brioche Tressée 500g': 58,
  'Hạt điều rang muối Bình Phước hũ 250g': 59,
  'Đậu phộng da cá Tân Tân hũ 275g': 60,
};

async function populateCoPurchase() {
  const startTime = Date.now();
  console.log('\n🔄 Populate Co-Purchase Stats từ mock orders...\n');

  try {
    // ── STEP 1: Đọc ALL order details trong 1 query (JOIN) ──
    console.log('📖 Đọc toàn bộ order details...');
    const { rows } = await pool.query(`
      SELECT o.id AS order_id, o.store_id, d.product_name
      FROM sale_order o
      JOIN sale_order_detail d ON d.order_id = o.id
      WHERE o.status = 'delivered' AND o.payment_status = 'paid'
      ORDER BY o.id
    `);

    if (rows.length === 0) {
      console.log('⚠️  Không có order detail nào. Chạy mock-orders.js trước!');
      return;
    }
    console.log(`   → ${rows.length} dòng order detail từ DB.\n`);

    // ── STEP 2: Group by order_id (in-memory) ──
    const orderMap = new Map(); // order_id → { storeId, productIds[] }
    let unmappedNames = new Set();

    for (const row of rows) {
      const productId = NAME_TO_ID[row.product_name];
      if (!productId) {
        unmappedNames.add(row.product_name);
        continue;
      }

      if (!orderMap.has(row.order_id)) {
        orderMap.set(row.order_id, { storeId: row.store_id, productIds: [] });
      }
      orderMap.get(row.order_id).productIds.push(productId);
    }
    console.log(`📦 ${orderMap.size} đơn hàng có product_id hợp lệ.`);

    // ── STEP 3: Aggregate co-purchase pairs (in-memory) ──
    // Key: "productA-productB-storeId" → count
    const pairCounts = new Map();
    let ordersProcessed = 0;

    for (const [, { storeId, productIds }] of orderMap) {
      const unique = [...new Set(productIds)];
      if (unique.length < 2) continue;

      for (let i = 0; i < unique.length; i++) {
        for (let j = i + 1; j < unique.length; j++) {
          const [a, b] = [unique[i], unique[j]].sort((x, y) => x - y);
          const key = `${a}-${b}-${storeId}`;
          pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
        }
      }
      ordersProcessed++;
    }

    console.log(`🔗 ${pairCounts.size} unique pairs aggregated in-memory.`);

    if (pairCounts.size === 0) {
      console.log('⚠️  Không có pair nào. Kiểm tra lại dữ liệu orders.');
      return;
    }

    // ── STEP 4: Clear old + Batch INSERT (1 query) ──
    console.log('\n🧹 Clear co_purchase_stats cũ...');
    await pool.query('TRUNCATE TABLE co_purchase_stats CASCADE');

    // Build batch VALUES: ($1,$2,$3,$4), ($5,$6,$7,$8), ...
    const values = [];
    const params = [];
    let idx = 1;

    for (const [key, count] of pairCounts) {
      const [a, b, storeId] = key.split('-').map(Number);
      values.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, NOW())`);
      params.push(a, b, storeId, count);
      idx += 4;
    }

    // Batch insert — chunk nếu quá 1000 pairs (tránh param limit ~65535)
    const CHUNK_SIZE = 1000;
    const entries = [...pairCounts.entries()];

    for (let c = 0; c < entries.length; c += CHUNK_SIZE) {
      const chunk = entries.slice(c, c + CHUNK_SIZE);
      const chunkValues = [];
      const chunkParams = [];
      let ci = 1;

      for (const [key, count] of chunk) {
        const [a, b, storeId] = key.split('-').map(Number);
        chunkValues.push(`($${ci}, $${ci + 1}, $${ci + 2}, $${ci + 3}, NOW())`);
        chunkParams.push(a, b, storeId, count);
        ci += 4;
      }

      await pool.query(`
        INSERT INTO co_purchase_stats (product_id_a, product_id_b, store_id, co_purchase_count, last_updated_at)
        VALUES ${chunkValues.join(', ')}
      `, chunkParams);

      console.log(`   ✓ Inserted chunk ${Math.floor(c / CHUNK_SIZE) + 1} (${chunk.length} pairs)`);
    }

    // ── STEP 5: Thống kê kết quả ──
    const statsResult = await pool.query(`
      SELECT COUNT(*)::int AS total_pairs, 
             SUM(co_purchase_count)::int AS total_frequency,
             MAX(co_purchase_count)::int AS max_frequency
      FROM co_purchase_stats
    `);
    const stats = statsResult.rows[0];

    const topPairs = await pool.query(`
      SELECT product_id_a, product_id_b, co_purchase_count
      FROM co_purchase_stats
      ORDER BY co_purchase_count DESC
      LIMIT 10
    `);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✅ HOÀN THÀNH trong ${elapsed}s!`);
    console.log(`   📊 Đơn hàng xử lý: ${ordersProcessed}/${orderMap.size}`);
    console.log(`   📈 Unique pairs: ${stats.total_pairs}`);
    console.log(`   📈 Total frequency: ${stats.total_frequency}`);
    console.log(`   📈 Max frequency: ${stats.max_frequency}`);

    if (unmappedNames.size > 0) {
      console.log(`\n   ⚠️  ${unmappedNames.size} product_name không map được:`);
      for (const n of unmappedNames) console.log(`      - "${n}"`);
    }

    console.log(`\n🏆 Top 10 Co-Purchase Pairs:`);
    console.log('   ─────────────────────────────────────────');
    for (const row of topPairs.rows) {
      const nameA = Object.entries(NAME_TO_ID).find(([, id]) => id === Number(row.product_id_a))?.[0] || `#${row.product_id_a}`;
      const nameB = Object.entries(NAME_TO_ID).find(([, id]) => id === Number(row.product_id_b))?.[0] || `#${row.product_id_b}`;
      console.log(`   [${row.co_purchase_count}x] ${nameA}`);
      console.log(`        ↔ ${nameB}`);
    }

    console.log(`\n💡 Dữ liệu co_purchase_stats đã sẵn sàng cho thuật toán Apriori.\n`);

  } catch (err) {
    console.error('\n❌ Lỗi:', err.message);
    console.error(err);
  } finally {
    await pool.end();
  }
}

populateCoPurchase();
