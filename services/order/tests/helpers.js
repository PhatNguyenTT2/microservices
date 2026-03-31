/**
 * Test helpers: Mock factories and fixtures for Service 3 (Order & Payment)
 */

function mockOrderRepo() {
  return {
    findAll: jest.fn(), findById: jest.fn(), createWithClient: jest.fn(),
    updateStatus: jest.fn(), updatePaymentStatus: jest.fn(), updateTotal: jest.fn()
  };
}

function mockOrderDetailRepo() {
  return { findByOrderId: jest.fn(), createWithClient: jest.fn(), deleteByOrderId: jest.fn(), getOrderTotal: jest.fn() };
}

function mockPaymentRepo() {
  return {
    findByReference: jest.fn(), findById: jest.fn(), createWithClient: jest.fn(),
    updateStatus: jest.fn(), getTotalPaidForOrder: jest.fn(), getTotalPaidWithClient: jest.fn()
  };
}

function mockVnpayRepo() {
  return { findByTxnRef: jest.fn(), findByOrderId: jest.fn(), create: jest.fn(), updateFromIPN: jest.fn(), markReturnAccessed: jest.fn() };
}

function createMockPool() {
  const client = { query: jest.fn(), release: jest.fn() };
  return { connect: jest.fn().mockResolvedValue(client), query: jest.fn(), _client: client };
}

const FIXTURES = {
  order: {
    id: 1, customer_id: 10, created_by: 1, order_date: new Date(),
    delivery_type: 'pickup', address: null, shipping_fee: 0, discount_percentage: 0,
    total_amount: 100000, payment_status: 'pending', status: 'draft'
  },
  orderDetail: { id: 1, order_id: 1, product_name: 'Sữa tươi', batch_id: 1, quantity: 2, unit_price: 25000, total_price: 50000 },
  payment: { id: 1, amount: 50000, method: 'cash', status: 'completed', reference_type: 'Order', reference_id: 1, created_by: 1 },
  vnpayTxn: {
    id: 1, order_id: 1, vnp_txn_ref: '1_1710000000000', vnp_amount: 10000000,
    status: 'pending', ipn_verified: false, return_url_accessed: false
  }
};

module.exports = { mockOrderRepo, mockOrderDetailRepo, mockPaymentRepo, mockVnpayRepo, createMockPool, FIXTURES };
