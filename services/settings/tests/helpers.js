/**
 * Test helpers: Mock factories and fixtures for Service 4 (Settings)
 */

function mockSecurityRepo() { return { get: jest.fn(), updateWithClient: jest.fn() }; }
function mockSalesRepo() { return { get: jest.fn(), updateWithClient: jest.fn() }; }
function mockHistoryRepo() { return { findAll: jest.fn(), createWithClient: jest.fn() }; }

function createMockPool() {
  const client = { query: jest.fn(), release: jest.fn() };
  return { connect: jest.fn().mockResolvedValue(client), query: jest.fn(), _client: client };
}

const FIXTURES = {
  security: { id: 1, max_failed_attempts: 5, lock_duration_minutes: 30 },
  sales: { id: 1, auto_promotion_enabled: false, discount_vip: 10 }
};

module.exports = { mockSecurityRepo, mockSalesRepo, mockHistoryRepo, createMockPool, FIXTURES };
