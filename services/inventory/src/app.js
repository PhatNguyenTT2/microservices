const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { errorHandler } = require('../../../shared/common/errors');
const healthRoutes = require('./routes/health.routes');

function createApp({ inventoryService, stockOutService, warehouseService, batchRepo, inventoryRepo, catalogServiceUrl }) {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  app.use('/', healthRoutes);

  app.use('/api/inventory', require('./routes/inventory.routes')(inventoryService, inventoryRepo, { catalogServiceUrl }));
  app.use('/api/stock-out', require('./routes/stock-out.routes')(stockOutService));
  app.use('/api/batches', require('./routes/batch.routes')(batchRepo));
  app.use('/api/warehouse', require('./routes/warehouse.routes')(warehouseService));

  app.use(errorHandler);

  return app;
}

module.exports = createApp;
