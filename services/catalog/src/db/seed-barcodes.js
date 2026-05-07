/**
 * One-time script: Generate EAN-13 barcodes for existing products
 * Uses the same algorithm as ProductService.generateBarcode()
 * 
 * Usage: node seed-barcodes.js
 * Loads DB config from microservices/.env automatically
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });
const { Pool } = require('pg');

const DATABASE_URL = process.env.CATALOG_DATABASE_URL || process.env.DATABASE_URL;
if (!DATABASE_URL) {
    console.error('ERROR: CATALOG_DATABASE_URL or DATABASE_URL not found in .env');
    process.exit(1);
}

console.log('Connecting to Catalog DB...');
const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

function generateBarcode(productId) {
    const base = '200' + String(productId).padStart(9, '0');
    const digits = base.split('').map(Number);
    const sum = digits.reduce((s, d, i) => s + d * (i % 2 === 0 ? 1 : 3), 0);
    const checkDigit = (10 - (sum % 10)) % 10;
    return base + checkDigit;
}

async function seedBarcodes() {
    const client = await pool.connect();
    try {
        const { rows } = await client.query(
            'SELECT id FROM product WHERE barcode IS NULL ORDER BY id'
        );

        if (rows.length === 0) {
            console.log('All products already have barcodes. Nothing to do.');
            return;
        }

        console.log(`Found ${rows.length} products without barcodes. Generating...`);

        await client.query('BEGIN');
        let count = 0;

        for (const row of rows) {
            const barcode = generateBarcode(row.id);
            await client.query(
                'UPDATE product SET barcode = $1 WHERE id = $2',
                [barcode, row.id]
            );
            count++;
        }

        await client.query('COMMIT');
        console.log(`✅ Successfully generated ${count} EAN-13 barcodes.`);

        // Verify a few
        const { rows: samples } = await client.query(
            'SELECT id, name, barcode FROM product WHERE barcode IS NOT NULL ORDER BY id LIMIT 5'
        );
        console.log('\nSample barcodes:');
        samples.forEach(s => console.log(`  Product #${s.id} (${s.name}): ${s.barcode}`));
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('ERROR:', error.message);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

seedBarcodes().catch(() => process.exit(1));
