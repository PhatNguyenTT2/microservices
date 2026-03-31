const logger = require('../common/logger');

/**
 * Transactional Outbox Pattern (§5.3)
 *
 * Ensures atomicity between DB commit and event publishing:
 * 1. Within a DB transaction, INSERT event into `outbox_events` table
 * 2. Background poller reads unpublished events → publishes to RabbitMQ → marks published
 *
 * Usage:
 *   const outbox = require('shared/outbox');
 *   // Inside a transaction:
 *   await outbox.insertEvent(client, 'payment.completed', { orderId, storeId, ... });
 *   // In index.js startup:
 *   outbox.startPoller(pool, eventBus, 3000);
 */

/**
 * Insert event into outbox_events table within an existing transaction.
 * MUST be called with a transaction client (not pool).
 */
async function insertEvent(client, eventType, payload) {
    const query = `
        INSERT INTO outbox_events (event_type, payload)
        VALUES ($1, $2)
        RETURNING id
    `;
    const { rows } = await client.query(query, [eventType, JSON.stringify(payload)]);
    return rows[0].id;
}

/**
 * Start background poller that reads unpublished outbox events
 * and publishes them to RabbitMQ via eventBus.
 *
 * Returns the interval ID for cleanup on shutdown.
 */
function startPoller(pool, eventBus, intervalMs = 3000) {
    const timer = setInterval(async () => {
        let client;
        try {
            client = await pool.connect();

            // Lock and fetch batch of unpublished events
            const { rows: events } = await client.query(`
                SELECT id, event_type, payload, created_at
                FROM outbox_events
                WHERE published_at IS NULL
                ORDER BY id ASC
                LIMIT 50
                FOR UPDATE SKIP LOCKED
            `);

            if (events.length === 0) {
                client.release();
                return;
            }

            for (const evt of events) {
                try {
                    await eventBus.publish(evt.event_type, evt.payload);

                    await client.query(
                        'UPDATE outbox_events SET published_at = NOW() WHERE id = $1',
                        [evt.id]
                    );
                } catch (pubErr) {
                    logger.error({ pubErr, eventId: evt.id, eventType: evt.event_type },
                        'Outbox: failed to publish event — will retry next cycle');
                    // Don't mark as published → will be retried
                }
            }

            client.release();
        } catch (err) {
            if (client) client.release();
            logger.error({ err }, 'Outbox poller error');
        }
    }, intervalMs);

    logger.info({ intervalMs }, 'Outbox poller started');
    return timer;
}

module.exports = { insertEvent, startPoller };
