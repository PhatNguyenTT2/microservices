const logger = require('../common/logger');

/**
 * Transactional Outbox Pattern (§5.3)
 *
 * CRITICAL FIX: When all services share a single database (e.g. Supabase),
 * outbox_events from ALL services live in the same table. Each poller MUST 
 * only read events belonging to its own service via `service_name` column.
 *
 * Usage:
 *   const outbox = require('shared/outbox');
 *   // Inside a transaction:
 *   await outbox.insertEvent(client, 'payment.completed', { ... }, 'payment-service');
 *   // In index.js startup:
 *   outbox.startPoller(pool, eventBus, 1000, 'payment-service');
 */

/**
 * Insert event into outbox_events table within an existing transaction.
 * MUST be called with a transaction client (not pool).
 * @param {object} client - DB transaction client
 * @param {string} eventType - Event type (e.g. 'payment.completed')
 * @param {object} payload - Event data
 * @param {string} [serviceName] - Service that owns this event (for shared-DB isolation)
 */
async function insertEvent(client, eventType, payload, serviceName) {
    const query = `
        INSERT INTO outbox_events (event_type, payload, service_name)
        VALUES ($1, $2, $3)
        RETURNING id
    `;
    const { rows } = await client.query(query, [eventType, JSON.stringify(payload), serviceName || null]);
    return rows[0].id;
}

/**
 * Start background poller that reads unpublished outbox events
 * and publishes them to RabbitMQ via eventBus.
 *
 * CRITICAL: When sharing a DB, serviceName MUST be provided to prevent
 * cross-service event pollution (one poller publishing another service's events).
 *
 * @param {object} pool - DB connection pool
 * @param {object} eventBus - RabbitMQ event bus
 * @param {number} intervalMs - Poll interval in ms
 * @param {string} [serviceName] - Only poll events from this service
 * @returns {number} Interval ID for cleanup
 */
function startPoller(pool, eventBus, intervalMs = 3000, serviceName) {
    const timer = setInterval(async () => {
        let client;
        try {
            client = await pool.connect();

            // Build query with optional service_name filter
            let query;
            let params;

            if (serviceName) {
                query = `
                    SELECT id, event_type, payload, created_at
                    FROM outbox_events
                    WHERE published_at IS NULL AND service_name = $1
                    ORDER BY id ASC
                    LIMIT 50
                    FOR UPDATE SKIP LOCKED
                `;
                params = [serviceName];
            } else {
                query = `
                    SELECT id, event_type, payload, created_at
                    FROM outbox_events
                    WHERE published_at IS NULL
                    ORDER BY id ASC
                    LIMIT 50
                    FOR UPDATE SKIP LOCKED
                `;
                params = [];
            }

            const { rows: events } = await client.query(query, params);

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
                }
            }

            client.release();
        } catch (err) {
            if (client) client.release();
            logger.error({ err }, 'Outbox poller error');
        }
    }, intervalMs);

    logger.info({ intervalMs, serviceName: serviceName || 'ALL' }, 'Outbox poller started');
    return timer;
}

module.exports = { insertEvent, startPoller };
