const amqp = require('amqplib');
const logger = require('../common/logger');

let connection = null;
let channel = null;

const EXCHANGE = 'posmart.events';

/**
 * Build RabbitMQ connection URL.
 * Supports 2 modes:
 *   1. RABBITMQ_URL (cloud: CloudAMQP, etc.)
 *   2. RABBITMQ_HOST/PORT/USER/PASSWORD (local Docker)
 */
function getConnectionUrl() {
  if (process.env.RABBITMQ_URL) {
    logger.info('RabbitMQ: using cloud URL');
    return process.env.RABBITMQ_URL;
  }

  const host = process.env.RABBITMQ_HOST || 'localhost';
  const port = process.env.RABBITMQ_PORT || 5672;
  const user = process.env.RABBITMQ_USER || 'posmart';
  const pass = process.env.RABBITMQ_PASSWORD || 'posmart_secret';
  logger.info({ host, port }, 'RabbitMQ: using local connection');
  return `amqp://${user}:${pass}@${host}:${port}`;
}

/**
 * Connect to RabbitMQ with retry logic.
 */
async function connect(retries = 10) {
  const url = getConnectionUrl();

  for (let i = 0; i < retries; i++) {
    try {
      connection = await amqp.connect(url);
      channel = await connection.createChannel();

      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });

      connection.on('error', (err) => {
        logger.error({ err }, 'RabbitMQ connection error');
      });

      connection.on('close', () => {
        logger.warn('RabbitMQ connection closed, reconnecting...');
        setTimeout(() => connect(retries), 5000);
      });

      logger.info('Connected to RabbitMQ');
      return channel;
    } catch (err) {
      logger.warn({ attempt: i + 1, retries }, 'RabbitMQ connection failed, retrying...');
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  throw new Error('Failed to connect to RabbitMQ after retries');
}

/**
 * Publish a domain event.
 */
async function publish(eventType, data) {
  if (!channel) throw new Error('Event bus not connected');

  const message = {
    type: eventType,
    data,
    timestamp: new Date().toISOString(),
    id: `${eventType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  };

  channel.publish(
    EXCHANGE,
    eventType,
    Buffer.from(JSON.stringify(message)),
    { persistent: true, contentType: 'application/json' }
  );

  logger.info({ eventType, messageId: message.id }, 'Event published');
}

/**
 * Subscribe to domain events.
 */
async function subscribe(serviceName, eventPattern, handler) {
  if (!channel) throw new Error('Event bus not connected');

  const queueName = `${serviceName}.${eventPattern.replace(/\*/g, 'all')}`;

  await channel.assertQueue(queueName, {
    durable: true,
    deadLetterExchange: `${EXCHANGE}.dlx`
  });

  await channel.bindQueue(queueName, EXCHANGE, eventPattern);

  channel.consume(queueName, async (msg) => {
    if (!msg) return;

    try {
      const message = JSON.parse(msg.content.toString());
      logger.info({ eventType: message.type, messageId: message.id }, 'Event received');
      await handler(message);
      channel.ack(msg);
    } catch (err) {
      logger.error({ err, queue: queueName }, 'Event handler error');
      channel.nack(msg, false, false);
    }
  });

  logger.info({ serviceName, eventPattern, queue: queueName }, 'Subscribed to events');
}

/**
 * Close connection gracefully.
 */
async function close() {
  if (channel) await channel.close();
  if (connection) await connection.close();
  logger.info('RabbitMQ connection closed');
}

module.exports = { connect, publish, subscribe, close };
