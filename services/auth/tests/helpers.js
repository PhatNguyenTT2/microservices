/**
 * Test helpers — mock factories and shared fixtures.
 */

const bcrypt = require('bcrypt');

// ===== Mock Factories =====

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

function mockUserRepo() {
  return createMockRepo([
    'findByUsername', 'findByEmail', 'findByUsernameOrEmail',
    'findById', 'create', 'createWithClient',
    'updateLastLogin', 'setActive', 'updateRole', 'getPermissions'
  ]);
}

function mockAuthRepo() {
  return createMockRepo([
    'saveToken', 'findToken', 'deleteToken', 'deleteUserTokens',
    'cleanExpiredTokens', 'findPosAuth', 'upsertPosAuth',
    'createPosAuthWithClient', 'incrementPosFailedAttempts', 'resetPosFailedAttempts'
  ]);
}

function mockEmployeeRepo() {
  return createMockRepo([
    'findAll', 'findByUserId', 'findById', 'create', 'createProfile', 'updateProfile', 'update', 'delete'
  ]);
}

function mockStoreRepo() {
  return createMockRepo([
    'findAll', 'findById', 'create', 'createWithClient', 'update', 'updateManagerWithClient'
  ]);
}

function mockCustomerRepo() {
  return createMockRepo([
    'findAll', 'findByUserId', 'create', 'update', 'delete'
  ]);
}

function mockRoleRepo() {
  return createMockRepo([
    'findAll', 'findById', 'findByName', 'create', 'update',
    'delete', 'setPermissions', 'getAllPermissions'
  ]);
}

// ===== Test Data Fixtures =====

const FIXTURES = {
  user: {
    id: 1,
    username: 'admin',
    email: 'admin@test.com',
    password_hash: bcrypt.hashSync('password123', 10),
    role_id: 1,
    role_name: 'Super Admin',
    is_active: true,
    last_login: null
  },
  inactiveUser: {
    id: 2,
    username: 'inactive',
    email: 'inactive@test.com',
    password_hash: bcrypt.hashSync('password123', 10),
    role_id: 1,
    role_name: 'Super Admin',
    is_active: false,
    last_login: null
  },
  employee: {
    user_id: 1,
    store_id: 1,
    full_name: 'Admin User',
    phone: '0123456789',
    address: '123 Street',
    gender: 'Male',
    dob: '1990-01-01',
    username: 'admin',
    email: 'admin@test.com',
    is_active: true,
    role_name: 'Super Admin',
    role_id: 1
  },
  store: {
    id: 1,
    name: 'Store 1',
    address: '456 Avenue',
    phone: '0111222333',
    manager_id: 1,
    is_active: true
  },
  customer: {
    user_id: 3,
    full_name: 'Customer Name',
    phone: '0987654321',
    gender: 'Female',
    dob: '1995-05-05',
    customer_type: 'retail',
    username: 'customer1',
    email: 'customer@test.com',
    is_active: true
  },
  role: {
    id: 1,
    name: 'Super Admin',
    description: 'Full access',
    permissions: [
      { id: 1, code: 'dashboard.view', description: 'View dashboard' },
      { id: 2, code: 'products.view', description: 'View products' }
    ]
  },
  permissions: ['dashboard.view', 'products.view', 'orders.view'],
  posAuth: {
    user_id: 1,
    pin_hash: bcrypt.hashSync('1234', 10),
    failed_attempts: 0,
    locked_until: null,
    is_enabled: true,
    last_login: null
  }
};

module.exports = {
  createMockPool,
  mockUserRepo, mockAuthRepo, mockEmployeeRepo, mockCustomerRepo, mockRoleRepo, mockStoreRepo,
  FIXTURES
};
