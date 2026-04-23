/**
 * Mock Orders Generator — Tạo 500 đơn hàng giả lập cho thuật toán Apriori
 * 
 * ⚠ QUAN TRỌNG:
 * - Order tables (sale_order, sale_order_detail) nằm trên SHARED DB (DATABASE_URL)
 * - Product tables (product) nằm trên CATALOG DB (CATALOG_DATABASE_URL) — DB riêng
 * - Script này KHÔNG query cross-DB, dùng bảng PRODUCT_CATALOG tĩnh thay thế
 * 
 * Chạy: cd microservices && node docs/chatbot/seed-product/mock-orders.js
 */
const { Pool } = require('pg');

// ============================================================
// 1. DATABASE — Shared DB (chứa sale_order + sale_order_detail)
// ============================================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ============================================================
// 2. PRODUCT CATALOG (snapshot từ seed.sql — tránh cross-DB query)
//    Vì product table đã tách sang CATALOG_DATABASE_URL riêng
// ============================================================
const PRODUCT_CATALOG = {
  1: { name: 'Ba chỉ bò Mỹ thái lát mỏng khay 500g', price: 125000 },
  2: { name: 'Nấm kim châm Hàn Quốc gói 150g', price: 18000 },
  3: { name: 'Rau muống VietGAP bó 500g', price: 15000 },
  4: { name: 'Gia vị nêm sẵn lẩu Thái Barona 80g', price: 16000 },
  5: { name: 'Bún tươi Ba Khánh gói 500g', price: 12000 },
  6: { name: 'Cá viên chiên xâu tôm viên Vissan 500g', price: 55000 },
  7: { name: 'Bánh mì Sandwich lạt Kinh Đô 275g', price: 22000 },
  8: { name: 'Lốc 4 hộp Sữa tươi Vinamilk không đường 180ml', price: 33000 },
  9: { name: 'Thùng 48 hộp Sữa tươi Vinamilk không đường 180ml', price: 385000 },
  10: { name: 'Trứng gà sạch V.Food hộp 10 quả', price: 35000 },
  11: { name: 'Xúc xích heo tiệt trùng Vissan gói 4 cây', price: 20000 },
  12: { name: 'Mì Hảo Hảo hương vị tôm chua cay 75g', price: 4500 },
  13: { name: 'Thùng 30 gói mì Hảo Hảo tôm chua cay', price: 115000 },
  14: { name: 'Mì xào khô Indomie vị sườn đặc biệt 85g', price: 6000 },
  15: { name: 'Phở bò Vifon gói 80g', price: 8000 },
  16: { name: 'Miến dong Phú Hương sườn heo', price: 9500 },
  17: { name: 'Bia Heineken Silver lon 330ml', price: 19500 },
  18: { name: 'Thùng 24 lon bia Tiger Bạc 330ml', price: 395000 },
  19: { name: 'Nước ngọt Coca-Cola vị nguyên bản chai 390ml', price: 9000 },
  20: { name: 'Snack khoai tây Lay\'s vị Tự nhiên 52g', price: 12000 },
  21: { name: 'Khô gà lá chanh G kitchen hũ 200g', price: 85000 },
  22: { name: 'Cải thìa mỡ VietGAP 500g', price: 16000 },
  23: { name: 'Cà chua mận đỏ Đà Lạt 500g', price: 25000 },
  24: { name: 'Hành tây vàng loại 1 kg', price: 30000 },
  25: { name: 'Chuối già Nam Mỹ nải 1kg', price: 28000 },
  26: { name: 'Cherry đỏ Mỹ size 9.5 Hộp 500g', price: 250000 },
  27: { name: 'Thịt sườn non heo chuẩn C.P 500g', price: 95000 },
  28: { name: 'Thịt ba rọi heo rút sườn 500g', price: 85000 },
  29: { name: 'Thăn ngoại bò Úc Hokubee cắt bít tết 250g', price: 165000 },
  30: { name: 'Tôm sú sinh thái lột vỏ đông lạnh 250g', price: 125000 },
  31: { name: 'Mực ống làm sạch khay 300g', price: 98000 },
  32: { name: 'Chả lụa heo G Kitchen đòn 500g', price: 95000 },
  33: { name: 'Há cảo tôm thịt mini Cầu Tre 500g', price: 65000 },
  34: { name: 'Xúc xích xông khói phô mai vòng CP 500g', price: 85000 },
  35: { name: 'Lốc 4 hộp Sữa tươi TH True Milk có đường 180ml', price: 34000 },
  36: { name: 'Lốc 4 hộp Sữa chua nha đam Vinamilk 100g', price: 28000 },
  37: { name: 'Phô mai Bò Lúc Lắc hộp 8 miếng 120g', price: 42000 },
  38: { name: 'Nước khoáng thiên nhiên La Vie chai 500ml', price: 6000 },
  39: { name: 'Nước tinh khiết Aquafina chai 1.5L', price: 12000 },
  40: { name: 'Trà Ô Long Tea+ Plus chai 455ml', price: 10000 },
  41: { name: 'Nước tăng lực Red Bull lon 250ml', price: 12000 },
  42: { name: 'Gạo thơm ST25 lúa tôm Ông Cua túi 5kg', price: 185000 },
  43: { name: 'Bao Gạo đặc sản ST25 Sóc Trăng 25kg', price: 875000 },
  44: { name: 'Gạo thơm Lài Miên túi 5kg', price: 110000 },
  45: { name: 'Nấm hương khô Tây Bắc gói 100g', price: 45000 },
  46: { name: 'Đậu đen xanh lòng hạt nhỏ 500g', price: 35000 },
  47: { name: 'Dầu ăn thực vật Tường An chai 1L', price: 48000 },
  48: { name: 'Dầu đậu nành Simply chai 2L', price: 125000 },
  49: { name: 'Nước mắm Nam Ngư 11 độ đạm chai 750ml', price: 32000 },
  50: { name: 'Nước mắm cá cơm Hưng Thịnh 35 độ đạm chai 620ml', price: 55000 },
  51: { name: 'Nước tương Chinsu tỏi ớt chai 250ml', price: 15000 },
  52: { name: 'Hạt nêm Knorr từ thịt thăn xương ống gói 400g', price: 38000 },
  53: { name: 'Bột ngọt Ajinomoto gói 454g', price: 33000 },
  54: { name: 'Đường tinh luyện Biên Hòa bịch 1kg', price: 25000 },
  55: { name: 'Bánh quy bơ Danisa hộp thiếc 454g', price: 135000 },
  56: { name: 'Bánh xốp phô mai Nabati hộp 150g', price: 28000 },
  57: { name: 'Kẹo mút Chupa Chups hương trái cây gói 10 que', price: 15000 },
  58: { name: 'Bánh mì hoa cúc Harrys Brioche Tressée 500g', price: 145000 },
  59: { name: 'Hạt điều rang muối Bình Phước hũ 250g', price: 95000 },
  60: { name: 'Đậu phộng da cá Tân Tân hũ 275g', price: 42000 },
};

// ============================================================
// 3. CLUSTERS — Nhóm sản phẩm hay mua cùng nhau (Apriori seed)
// ============================================================
const CLUSTERS = {
  LAU_BO: [1, 2, 3, 4, 5],       // Bò, Nấm, Rau, Gia vị lẩu, Bún
  BUA_SANG: [7, 8, 10, 11],        // Bánh mì, Sữa, Trứng, Xúc xích
  GIAI_KHAT: [17, 19, 20, 21],      // Bia, Coca, Snack, Khô gà
  RANDOM_NOISE: Object.keys(PRODUCT_CATALOG).map(Number)  // ID 1-60
};

// Default store & employee for mock data
const STORE_ID = 1;
const EMPLOYEE_ID = 1;

// ============================================================
// 4. HELPERS
// ============================================================
function getRandomSubset(array, minItems) {
  const shuffled = [...array].sort(() => 0.5 - Math.random());
  const size = Math.floor(Math.random() * (array.length - minItems + 1)) + minItems;
  return shuffled.slice(0, size);
}

function getRandomCustomerId() {
  return Math.floor(Math.random() * 50) + 1; // Customer 1-50
}

function getRandomDate() {
  // Random date in last 30 days
  const daysAgo = Math.floor(Math.random() * 30);
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

// ============================================================
// 5. MAIN — Generate mock orders
// ============================================================
async function generateMockOrders(totalOrders = 500) {
  const client = await pool.connect();
  console.log(`\n🚀 Bắt đầu giả lập ${totalOrders} đơn hàng...`);
  console.log(`📍 Store ID: ${STORE_ID}`);
  console.log(`🔗 Database: ${pool.options.host || 'shared DB'}\n`);

  const stats = { lauBo: 0, buaSang: 0, giaiKhat: 0, random: 0 };

  try {
    await client.query('BEGIN');

    for (let i = 0; i < totalOrders; i++) {
      // 1. Chọn cluster dựa trên xác suất
      const rand = Math.random();
      let cartProductIds = [];

      if (rand < 0.35) {
        cartProductIds = getRandomSubset(CLUSTERS.LAU_BO, 3);
        if (Math.random() > 0.5) {
          cartProductIds.push(...getRandomSubset(CLUSTERS.RANDOM_NOISE, 1));
        }
        stats.lauBo++;
      } else if (rand < 0.70) {
        cartProductIds = getRandomSubset(CLUSTERS.BUA_SANG, 2);
        stats.buaSang++;
      } else if (rand < 0.85) {
        cartProductIds = getRandomSubset(CLUSTERS.GIAI_KHAT, 2);
        stats.giaiKhat++;
      } else {
        cartProductIds = getRandomSubset(CLUSTERS.RANDOM_NOISE, Math.floor(Math.random() * 4) + 1);
        stats.random++;
      }

      // Loại trùng
      cartProductIds = [...new Set(cartProductIds)];

      // 2. Tính tổng tiền đơn hàng
      let totalAmount = 0;
      const items = cartProductIds.map(productId => {
        const product = PRODUCT_CATALOG[productId];
        const qty = Math.floor(Math.random() * 3) + 1;
        const lineTotal = product.price * qty;
        totalAmount += lineTotal;
        return { productId, name: product.name, price: product.price, qty, lineTotal };
      });

      // 3. Insert sale_order (đúng schema thực tế)
      const orderRes = await client.query(
        `INSERT INTO sale_order 
           (store_id, customer_id, created_by, order_date, delivery_type, 
            total_amount, payment_status, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
         RETURNING id`,
        [
          STORE_ID,
          getRandomCustomerId(),
          EMPLOYEE_ID,
          getRandomDate(),
          'pickup',            // Mock orders = pickup tại cửa hàng
          totalAmount,
          'paid',              // Đã thanh toán
          'delivered'          // Đã giao (completed)
        ]
      );
      const orderId = orderRes.rows[0].id;

      // 4. Insert sale_order_detail (đúng schema thực tế)
      for (const item of items) {
        await client.query(
          `INSERT INTO sale_order_detail 
             (order_id, product_id, product_name, batch_id, quantity, unit_price, total_price)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            orderId,
            item.productId,    // product_id (cross-service reference)
            item.name,         // product_name (snapshot text)
            1,                 // batch_id — mock default = 1
            item.qty,
            item.price,        // unit_price (NUMERIC >= 0)
            item.lineTotal     // total_price = unit_price × quantity
          ]
        );
      }

      // Progress log mỗi 100 đơn
      if ((i + 1) % 100 === 0) {
        console.log(`  ✓ ${i + 1}/${totalOrders} đơn hàng đã tạo...`);
      }
    }

    await client.query('COMMIT');

    console.log(`\n✅ Hoàn thành! Đã tạo ${totalOrders} đơn hàng mock.`);
    console.log(`\n📊 Phân bổ clusters:`);
    console.log(`   🍲 Lẩu Bò:   ${stats.lauBo} đơn (${(stats.lauBo / totalOrders * 100).toFixed(1)}%)`);
    console.log(`   🍳 Bữa Sáng: ${stats.buaSang} đơn (${(stats.buaSang / totalOrders * 100).toFixed(1)}%)`);
    console.log(`   🍺 Giải Khát: ${stats.giaiKhat} đơn (${(stats.giaiKhat / totalOrders * 100).toFixed(1)}%)`);
    console.log(`   🎲 Random:    ${stats.random} đơn (${(stats.random / totalOrders * 100).toFixed(1)}%)`);
    console.log(`\n💡 Bước tiếp theo: Chạy batch job Apriori để tính support/confidence/lift`);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Lỗi khi giả lập đơn hàng:', err.message);
    console.error('Detail:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

// Thực thi
generateMockOrders(500);