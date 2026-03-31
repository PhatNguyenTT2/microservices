const pino = require('pino');

let transport;
if (process.env.NODE_ENV === 'development') {
  try {
    require.resolve('pino-pretty');
    transport = { target: 'pino-pretty', options: { colorize: true } };
  } catch {
    // pino-pretty not installed, use default JSON output
  }
}

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  ...(transport && { transport })
});

module.exports = logger;
