/**
 * Mock Interactions Generator — Phase 2 CF Data Seeding
 * 
 * Tạo user_product_interaction với 4 nhóm persona rõ ràng:
 * 
 * 1. "Nội trợ Nấu lẩu"       (User 1-150):   Bò, Nấm, Rau, Gia vị, Bún      → 5-10x/tháng
 * 2. "Sinh viên Ăn vặt"       (User 151-300):  Mì, Xúc xích, Nước ngọt, Snack  → 10-20x/tháng
 * 3. "Dân nhậu Cuối tuần"     (User 301-450):  Bia, Khô gà, Đậu phộng          → 2-4x/tháng
 * 4. "Random/Khách vãng lai"  (User 451-500):  Mua lung tung                    → noise
 * 
 * Sau khi tạo interactions → auto-compute Adjusted Cosine Similarity.
 * 
 * Chạy: cd microservices && node docs/chatbot/seed-product/mock-interactions.js
 */
const { Pool } = require('pg');

// ── DB Connection (all tables in shared Supabase) ──
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const STORE_ID = 1;

// ============================================================
// PRODUCT CATALOG (ID → name, matching seed.sql)
// ============================================================
const PRODUCTS = {
  1: 'Ba chỉ bò Mỹ', 2: 'Nấm kim châm', 3: 'Rau muống VietGAP',
  4: 'Gia vị lẩu Thái', 5: 'Bún tươi', 6: 'Cá viên chiên Vissan',
  7: 'Bánh mì Sandwich', 8: 'Sữa Vinamilk', 9: 'Thùng sữa Vinamilk',
  10: 'Trứng gà sạch', 11: 'Xúc xích Vissan', 12: 'Mì Hảo Hảo',
  13: 'Dầu ăn Tường An', 14: 'Gạo ST25', 15: 'Đường trắng',
  16: 'Muối iốt', 17: 'Bia Heineken', 18: 'Bia Tiger',
  19: 'Coca-Cola', 20: 'Snack Lays', 21: 'Khô gà lá chanh',
  22: 'Đậu phộng rang', 23: 'Nước tương Maggi', 24: 'Cà chua',
  25: 'Hành tây', 26: 'Tỏi', 27: 'Ớt hiểm', 28: 'Chanh',
  29: 'Rau xà lách', 30: 'Dưa leo', 49: 'Nước mắm Nam Ngư',
  52: 'Hạt nêm Knorr', 53: 'Bột ngọt Ajinomoto',
};

// ============================================================
// USER PERSONA CLUSTERS
// ============================================================
const CLUSTERS = {
  // Nhóm 1: Nội trợ Nấu lẩu (150 users)
  NOI_TRO: {
    userRange: [1, 150],
    primary: [1, 2, 3, 4, 5, 24, 25, 26, 27, 28],     // Bò, Nấm, Rau, Gia vị lẩu, Bún, Cà chua, Hành, Tỏi, Ớt, Chanh
    secondary: [6, 13, 49, 52, 53, 23, 16],              // Cá viên, Dầu ăn, Nước mắm, Hạt nêm, Bột ngọt, Nước tương, Muối
    avoid: [17, 18, 12, 19, 20, 21],                      // Bia, Mì gói, Coca, Snack, Khô gà
    primaryFreq: [5, 10],   // 5-10 lần/tháng
    secondaryFreq: [1, 3],  // 1-3 lần/tháng
  },

  // Nhóm 2: Sinh viên Ăn vặt & Thức khuya (150 users)
  SINH_VIEN: {
    userRange: [151, 300],
    primary: [12, 11, 19, 20, 7, 8],                     // Mì Hảo Hảo, Xúc xích, Coca, Snack, Bánh mì, Sữa
    secondary: [10, 15, 9, 22],                            // Trứng, Đường, Thùng sữa, Đậu phộng
    avoid: [1, 2, 3, 4, 24, 25, 26, 49, 52, 53],          // Bò Mỹ, Nấm, Rau, Gia vị, Cà chua, Hành, Tỏi, Nước mắm
    primaryFreq: [10, 20],  // 10-20 lần/tháng
    secondaryFreq: [2, 5],
  },

  // Nhóm 3: Dân nhậu Cuối tuần (150 users)
  DAN_NHAU: {
    userRange: [301, 450],
    primary: [17, 18, 21, 22, 6],                          // Bia Heineken, Tiger, Khô gà, Đậu phộng, Cá viên
    secondary: [20, 19, 28, 27],                            // Snack, Coca, Chanh, Ớt
    avoid: [1, 2, 3, 14, 15, 52, 53],                      // Bò, Nấm, Rau, Gạo, Đường, Hạt nêm
    primaryFreq: [2, 4],    // 2-4 lần/tháng
    secondaryFreq: [1, 2],
  },

  // Nhóm 4: Random / Khách vãng lai (50 users)
  RANDOM: {
    userRange: [451, 500],
    primary: null,  // Random products
    secondary: null,
    avoid: [],
    primaryFreq: [1, 3],
    secondaryFreq: [1, 1],
  }
};

// ============================================================
// HELPERS
// ============================================================
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randSubset(arr, minCount, maxCount) {
  const count = randInt(minCount, Math.min(maxCount, arr.length));
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function generateRecencyWeight() {
  // Simulate days since last purchase: 1-90 days
  const days = randInt(1, 90);
  return Math.round(Math.exp(-0.01 * days) * 10000) / 10000;
}

// ============================================================
// MAIN
// ============================================================
async function generateMockInteractions() {
  const startTime = Date.now();
  console.log('\n🧑‍🤝‍🧑 Mock Interactions Generator — Phase 2 CF Data Seeding\n');

  try {
    // Check if tables exist
    const { rows: tableCheck } = await pool.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_name = 'user_product_interaction'
    `);
    if (tableCheck.length === 0) {
      console.log('❌ Table user_product_interaction not found. Rebuild chatbot container first!');
      return;
    }

    // Clear existing data
    console.log('🧹 Clearing existing interaction data...');
    await pool.query('DELETE FROM item_similarity WHERE store_id = $1', [STORE_ID]);
    await pool.query('DELETE FROM user_product_interaction WHERE store_id = $1', [STORE_ID]);

    const allInteractions = [];
    const stats = { noiTro: 0, sinhVien: 0, danNhau: 0, random: 0, totalRows: 0 };
    const allProductIds = Object.keys(PRODUCTS).map(Number);

    for (const [clusterName, cluster] of Object.entries(CLUSTERS)) {
      const [startUser, endUser] = cluster.userRange;
      const userCount = endUser - startUser + 1;
      let clusterRows = 0;

      console.log(`\n📋 Cluster: ${clusterName} (User ${startUser}-${endUser}, ${userCount} users)`);

      for (let userId = startUser; userId <= endUser; userId++) {
        const userInteractions = new Map(); // productId → { count, qty, recency }

        if (cluster.primary === null) {
          // RANDOM cluster: pick 3-8 random products
          const randomProducts = randSubset(allProductIds, 3, 8);
          for (const pid of randomProducts) {
            const count = randInt(cluster.primaryFreq[0], cluster.primaryFreq[1]);
            userInteractions.set(pid, {
              count,
              qty: count * randInt(1, 3),
              recency: generateRecencyWeight()
            });
          }
        } else {
          // Primary products (high frequency)
          const primaryPicks = randSubset(cluster.primary, 
            Math.ceil(cluster.primary.length * 0.6), 
            cluster.primary.length);
          
          for (const pid of primaryPicks) {
            const count = randInt(cluster.primaryFreq[0], cluster.primaryFreq[1]);
            userInteractions.set(pid, {
              count,
              qty: count * randInt(1, 4),
              recency: generateRecencyWeight()
            });
          }

          // Secondary products (low frequency)
          if (cluster.secondary) {
            const secondaryPicks = randSubset(cluster.secondary, 1, 
              Math.ceil(cluster.secondary.length * 0.5));
            for (const pid of secondaryPicks) {
              const count = randInt(cluster.secondaryFreq[0], cluster.secondaryFreq[1]);
              userInteractions.set(pid, {
                count,
                qty: count * randInt(1, 2),
                recency: generateRecencyWeight()
              });
            }
          }

          // Occasional noise: 10% chance to buy 1 random "avoid" product
          if (Math.random() < 0.10 && cluster.avoid.length > 0) {
            const noisePid = cluster.avoid[randInt(0, cluster.avoid.length - 1)];
            if (!userInteractions.has(noisePid)) {
              userInteractions.set(noisePid, { count: 1, qty: 1, recency: 0.5 });
            }
          }
        }

        // Convert to rows
        for (const [pid, data] of userInteractions) {
          const interactionScore = Math.round(data.count * data.recency * 1000) / 1000;
          allInteractions.push([
            userId, pid, STORE_ID,
            data.count, data.qty,
            interactionScore
          ]);
        }

        clusterRows += userInteractions.size;
      }

      stats[clusterName === 'NOI_TRO' ? 'noiTro' : 
            clusterName === 'SINH_VIEN' ? 'sinhVien' :
            clusterName === 'DAN_NHAU' ? 'danNhau' : 'random'] = clusterRows;
      stats.totalRows += clusterRows;
      console.log(`   → ${clusterRows} interaction rows generated.`);
    }

    // Batch INSERT
    console.log(`\n💾 Inserting ${allInteractions.length} interactions...`);
    const INSERT_CHUNK = 300;
    for (let c = 0; c < allInteractions.length; c += INSERT_CHUNK) {
      const chunk = allInteractions.slice(c, c + INSERT_CHUNK);
      const values = [];
      const params = [];
      let pi = 1;

      for (const row of chunk) {
        values.push(`($${pi}, $${pi+1}, $${pi+2}, $${pi+3}, $${pi+4}, NOW(), $${pi+5})`);
        params.push(...row);
        pi += 6;
      }

      await pool.query(`
        INSERT INTO user_product_interaction 
          (user_id, product_id, store_id, purchase_count, total_quantity, last_purchased_at, interaction_score)
        VALUES ${values.join(', ')}
        ON CONFLICT (user_id, product_id, store_id)
        DO UPDATE SET 
          purchase_count = EXCLUDED.purchase_count,
          total_quantity = EXCLUDED.total_quantity,
          last_purchased_at = EXCLUDED.last_purchased_at,
          interaction_score = EXCLUDED.interaction_score
      `, params);
    }

    console.log(`   ✓ ${allInteractions.length} rows inserted.`);

    // ── Compute Item Similarities ──
    console.log('\n🧮 Computing Adjusted Cosine Similarities...');
    const CollaborativeFilteringService = require('../../../services/chatbot/src/services/cf.service');
    const cfService = new CollaborativeFilteringService(pool);
    const result = await cfService.computeItemSimilarities(STORE_ID, 2);

    // ── Summary ──
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✅ HOÀN THÀNH trong ${elapsed}s!`);
    console.log(`   📊 Interactions: ${allInteractions.length} rows`);
    console.log(`   👥 Users: 500 (4 clusters)`);
    console.log(`   🔗 Item similarities: ${result.pairsComputed} pairs`);
    console.log(`\n   Cluster breakdown:`);
    console.log(`   🍲 Nội trợ Nấu lẩu (1-150): ${stats.noiTro} rows`);
    console.log(`   🍜 Sinh viên Ăn vặt (151-300): ${stats.sinhVien} rows`);
    console.log(`   🍺 Dân nhậu (301-450): ${stats.danNhau} rows`);
    console.log(`   🎲 Random (451-500): ${stats.random} rows`);

    // ── Top similarities ──
    const { rows: topSims } = await pool.query(`
      SELECT item_a, item_b, 
             ROUND(similarity::numeric, 4) AS similarity, 
             common_users
      FROM item_similarity
      WHERE store_id = $1
      ORDER BY similarity DESC
      LIMIT 15
    `, [STORE_ID]);

    console.log(`\n🏆 Top 15 Item Similarities:`);
    console.log('   ─────────────────────────────────────────');
    for (const s of topSims) {
      const nameA = PRODUCTS[s.item_a] || `Product #${s.item_a}`;
      const nameB = PRODUCTS[s.item_b] || `Product #${s.item_b}`;
      console.log(`   [sim=${s.similarity}] ${nameA} ↔ ${nameB} (${s.common_users} users)`);
    }

    // ── Verify cluster separation ──
    console.log(`\n🔍 Cluster Separation Verification:`);
    
    // Lẩu cluster items should have high similarity
    const lauSim = await pool.query(`
      SELECT ROUND(similarity::numeric, 4) AS sim
      FROM item_similarity WHERE item_a = 1 AND item_b = 2 AND store_id = $1
    `, [STORE_ID]);
    console.log(`   Bò(1) ↔ Nấm(2): sim=${lauSim.rows[0]?.sim || 'N/A'} (expected: > 0.5)`);

    // Cross-cluster items should have low/negative similarity
    const crossSim = await pool.query(`
      SELECT ROUND(similarity::numeric, 4) AS sim
      FROM item_similarity WHERE item_a = 1 AND item_b = 12 AND store_id = $1
    `, [STORE_ID]);
    console.log(`   Bò(1) ↔ Mì(12): sim=${crossSim.rows[0]?.sim || 'N/A'} (expected: < 0 or near 0)`);

    const nhauSim = await pool.query(`
      SELECT ROUND(similarity::numeric, 4) AS sim
      FROM item_similarity WHERE item_a = 17 AND item_b = 21 AND store_id = $1
    `, [STORE_ID]);
    console.log(`   Bia(17) ↔ Khô gà(21): sim=${nhauSim.rows[0]?.sim || 'N/A'} (expected: > 0.5)`);

    console.log(`\n💡 Interaction data seeded. CF recommendations ready.\n`);

  } catch (err) {
    console.error('\n❌ Lỗi:', err.message);
    console.error(err.stack);
  } finally {
    await pool.end();
  }
}

generateMockInteractions();
