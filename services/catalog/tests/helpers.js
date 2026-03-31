/**
 * Test helpers — mock factories and shared fixtures for Catalog Service.
 */

function createMockPool() {
  const client = {
    query: jest.fn(),
    release: jest.fn()
  };
  return {
    query: jest.fn(),
    connect: jest.fn().mockResolvedValue(client),
    _client: client
  };
}

function createMockRepo(methods) {
  const repo = {};
  for (const method of methods) {
    repo[method] = jest.fn();
  }
  return repo;
}

function mockCategoryRepo() {
  return createMockRepo([
    'findAll', 'findById', 'findByName', 'create', 'update', 'delete', 'countProducts'
  ]);
}

function mockProductRepo() {
  return createMockRepo([
    'findAll', 'findById', 'findByBarcode', 'create', 'update', 'delete',
    'createWithClient', 'updateWithClient'
  ]);
}

function mockPriceHistoryRepo() {
  return createMockRepo([
    'findByProductId', 'createWithClient'
  ]);
}

const FIXTURES = {
  category: {
    id: 1,
    name: 'Beverages',
    description: 'Drinks and beverages',
    is_active: true
  },
  product: {
    id: 1,
    name: 'Coca Cola',
    barcode: '8934588012340',
    category_id: 1,
    selling_price: 10000,
    is_active: true
  }
};

module.exports = {
  createMockPool,
  mockCategoryRepo, mockProductRepo, mockPriceHistoryRepo,
  FIXTURES
};
