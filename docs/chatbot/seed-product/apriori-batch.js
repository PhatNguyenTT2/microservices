/**
 * Apriori Batch Job — Tính support, confidence, lift cho co_purchase_stats
 * 
 * Công thức:
 *   support(A,B)     = count(A∧B) / |T|
 *   confidence(A→B)  = count(A∧B) / count(A)
 *   confidence(B→A)  = count(A∧B) / count(B)
 *   lift(A,B)        = (count(A∧B) × |T|) / (count(A) × count(B))
 * 
 * ⚠ Edge Case — Division by Zero:
 *   Nếu count(A)=0 hoặc count(B)=0 (sản phẩm bị xóa / data corrupt):
 *   → confidence = 0, lift = 0 (safe fallback, không throw NaN)
 * 
 * Strategy: In-memory aggregation (tránh N+1 query — bài học populate v1)
 * 
 * Chạy: cd microservices && node docs/chatbot/seed-product/apriori-batch.js
 */
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function computeAprioriMetrics() {
  const startTime = Date.now();
  console.log('\n🔬 Apriori Batch Job — Computing support, confidence, lift...\n');

  try {
    // ── Step 1: Total orders (|T|) ──
    const { rows: [{ total }] } = await pool.query(`
      SELECT COUNT(*)::int AS total 
      FROM sale_order 
      WHERE status = 'delivered' AND payment_status = 'paid'
    `);

    if (total === 0) {
      console.log('⚠️  Không có đơn hàng delivered. Chạy mock-orders.js trước!');
      return;
    }
    console.log(`📦 Total orders (|T|) = ${total}`);

    // ── Step 2: Product frequency — count(A) for each product ──
    // Đọc product_id từ sale_order_detail (cần migration P0 đã chạy)
    console.log('📊 Tính product frequency...');
    const { rows: freqRows } = await pool.query(`
      SELECT d.product_id, o.store_id, COUNT(DISTINCT o.id)::int AS order_count
      FROM sale_order_detail d
      JOIN sale_order o ON o.id = d.order_id
      WHERE o.status = 'delivered' AND o.payment_status = 'paid'
        AND d.product_id IS NOT NULL
      GROUP BY d.product_id, o.store_id
    `);

    if (freqRows.length === 0) {
      console.log('⚠️  Không có product_id trong sale_order_detail. Re-run mock-orders.js!');
      return;
    }
    console.log(`   → ${freqRows.length} product-store frequencies computed.`);

    // Build in-memory lookup: "productId-storeId" → order_count
    const freqMap = new Map();
    for (const r of freqRows) {
      freqMap.set(`${r.product_id}-${r.store_id}`, r.order_count);
    }

    // ── Step 3: Upsert product_order_frequency (batch) ──
    console.log('💾 Upsert product_order_frequency...');
    const freqValues = [];
    const freqParams = [];
    let fi = 1;
    for (const r of freqRows) {
      freqValues.push(`($${fi}, $${fi + 1}, $${fi + 2}, NOW())`);
      freqParams.push(r.product_id, r.store_id, r.order_count);
      fi += 3;
    }

    // Chunk if too many params
    const FREQ_CHUNK = 500;
    for (let c = 0; c < freqRows.length; c += FREQ_CHUNK) {
      const chunk = freqRows.slice(c, c + FREQ_CHUNK);
      const cv = [];
      const cp = [];
      let ci = 1;
      for (const r of chunk) {
        cv.push(`($${ci}, $${ci + 1}, $${ci + 2}, NOW())`);
        cp.push(r.product_id, r.store_id, r.order_count);
        ci += 3;
      }
      await pool.query(`
        INSERT INTO product_order_frequency (product_id, store_id, order_count, last_computed_at)
        VALUES ${cv.join(', ')}
        ON CONFLICT (product_id, store_id)
        DO UPDATE SET order_count = EXCLUDED.order_count, last_computed_at = NOW()
      `, cp);
    }
    console.log(`   → ${freqRows.length} rows upserted.`);

    // ── Step 4: Read all co_purchase_stats pairs ──
    console.log('🔗 Reading co_purchase_stats pairs...');
    const { rows: pairs } = await pool.query(`
      SELECT id, product_id_a, product_id_b, store_id, co_purchase_count
      FROM co_purchase_stats
    `);
    console.log(`   → ${pairs.length} pairs to compute.`);

    // ── Step 5: Compute metrics in-memory ──
    console.log('🧮 Computing Apriori metrics in-memory...');
    const updates = [];
    let divByZeroCount = 0;

    for (const pair of pairs) {
      const countAB = pair.co_purchase_count;
      const countA = freqMap.get(`${pair.product_id_a}-${pair.store_id}`) || 0;
      const countB = freqMap.get(`${pair.product_id_b}-${pair.store_id}`) || 0;

      // ⚠ Division by zero guard
      const support = total > 0 ? countAB / total : 0;
      const confidenceAB = countA > 0 ? countAB / countA : 0;
      const confidenceBA = countB > 0 ? countAB / countB : 0;
      const lift = (countA > 0 && countB > 0)
        ? (countAB * total) / (countA * countB)
        : 0;

      if (countA === 0 || countB === 0) {
        divByZeroCount++;
      }

      updates.push({
        id: pair.id,
        support: Math.round(support * 10000) / 10000,       // 4 decimal
        confidenceAB: Math.round(confidenceAB * 10000) / 10000,
        confidenceBA: Math.round(confidenceBA * 10000) / 10000,
        lift: Math.round(lift * 100) / 100,                  // 2 decimal
        totalOrders: total
      });
    }

    if (divByZeroCount > 0) {
      console.log(`   ⚠️  ${divByZeroCount} pairs had division-by-zero (count(A) or count(B) = 0) → set to 0`);
    }

    // ── Step 6: Batch UPDATE (chunked to avoid param limit) ──
    console.log('💾 Batch updating co_purchase_stats...');
    const UPDATE_CHUNK = 200;
    for (let c = 0; c < updates.length; c += UPDATE_CHUNK) {
      const chunk = updates.slice(c, c + UPDATE_CHUNK);

      // Build: UPDATE ... FROM (VALUES (...)) AS v(id, support, ...)
      const valueRows = [];
      const params = [];
      let pi = 1;
      for (const u of chunk) {
        valueRows.push(`($${pi}::bigint, $${pi+1}::numeric, $${pi+2}::numeric, $${pi+3}::numeric, $${pi+4}::numeric, $${pi+5}::int)`);
        params.push(u.id, u.support, u.confidenceAB, u.confidenceBA, u.lift, u.totalOrders);
        pi += 6;
      }

      await pool.query(`
        UPDATE co_purchase_stats AS cs
        SET support = v.support,
            confidence_ab = v.confidence_ab,
            confidence_ba = v.confidence_ba,
            lift = v.lift,
            total_orders = v.total_orders,
            last_updated_at = NOW()
        FROM (VALUES ${valueRows.join(', ')}) 
          AS v(id, support, confidence_ab, confidence_ba, lift, total_orders)
        WHERE cs.id = v.id
      `, params);

      console.log(`   ✓ Updated chunk ${Math.floor(c / UPDATE_CHUNK) + 1} (${chunk.length} pairs)`);
    }

    // ── Step 7: Summary stats ──
    const { rows: [stats] } = await pool.query(`
      SELECT 
        COUNT(*)::int AS total_pairs,
        COUNT(*) FILTER (WHERE lift > 1)::int AS positive_lift,
        COUNT(*) FILTER (WHERE lift > 2)::int AS strong_lift,
        ROUND(MAX(lift)::numeric, 2) AS max_lift,
        ROUND(MAX(confidence_ab)::numeric, 3) AS max_confidence,
        ROUND(AVG(lift)::numeric, 2) AS avg_lift
      FROM co_purchase_stats
    `);

    const topPairs = await pool.query(`
      SELECT product_id_a, product_id_b, co_purchase_count,
             ROUND(support::numeric, 4) AS support,
             ROUND(confidence_ab::numeric, 3) AS conf_ab,
             ROUND(confidence_ba::numeric, 3) AS conf_ba,
             ROUND(lift::numeric, 2) AS lift
      FROM co_purchase_stats
      ORDER BY lift DESC
      LIMIT 10
    `);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✅ HOÀN THÀNH trong ${elapsed}s!`);
    console.log(`   📊 Total pairs: ${stats.total_pairs}`);
    console.log(`   📈 Lift > 1 (positive): ${stats.positive_lift}`);
    console.log(`   🔥 Lift > 2 (strong): ${stats.strong_lift}`);
    console.log(`   📈 Max lift: ${stats.max_lift}`);
    console.log(`   📈 Max confidence: ${stats.max_confidence}`);
    console.log(`   📈 Avg lift: ${stats.avg_lift}`);

    if (divByZeroCount > 0) {
      console.log(`   ⚠️  Division-by-zero pairs: ${divByZeroCount} (set to 0)`);
    }

    console.log(`\n🏆 Top 10 Pairs by Lift:`);
    console.log('   ─────────────────────────────────────────');
    for (const r of topPairs.rows) {
      console.log(`   [lift=${r.lift}] Product ${r.product_id_a} ↔ ${r.product_id_b}`);
      console.log(`     count=${r.co_purchase_count} | support=${r.support} | conf(A→B)=${r.conf_ab} | conf(B→A)=${r.conf_ba}`);
    }

    console.log(`\n💡 Apriori metrics computed. CoPurchaseRepository can now rank by lift.\n`);

  } catch (err) {
    console.error('\n❌ Lỗi:', err.message);
    console.error(err);
  } finally {
    await pool.end();
  }
}

computeAprioriMetrics();
