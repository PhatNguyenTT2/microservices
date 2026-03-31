/**
 * Test helpers: Mock factories and fixtures for Service 5 (Supplier & PO)
 */

function mockSupplierRepo() {
  return {
    findAll: jest.fn(), findById: jest.fn(), findByName: jest.fn(),
    create: jest.fn(), update: jest.fn(), updateDebtWithClient: jest.fn()
  };
}

function mockPurchaseOrderRepo() {
  return {
    findAll: jest.fn(), findById: jest.fn(), createWithClient: jest.fn(),
    updateStatus: jest.fn(), updatePaymentStatus: jest.fn(), updateTotal: jest.fn()
  };
}

function mockPoDetailRepo() {
  return {
    findByPoId: jest.fn(), createWithClient: jest.fn(), updateBatchId: jest.fn()
  };
}

function createMockPool() {
  const client = { query: jest.fn(), release: jest.fn() };
  return { connect: jest.fn().mockResolvedValue(client), query: jest.fn(), _client: client };
}

const FIXTURES = {
  supplier: { 
    id: 1, company_name: 'Vinamilk', phone: '1900', address: 'HCM', 
    account_number: '123', payment_terms: 'net30', credit_limit: 50000000, 
    current_debt: 10000000, is_active: true 
  },
  purchaseOrder: {
    id: 1, supplier_id: 1, supplier_name: 'Vinamilk', order_date: new Date(),
    shipping_fee: 0, discount_percentage: 0, total_price: 20000000,
    status: 'draft', payment_status: 'unpaid', created_by: 1
  },
  poDetail: {
    id: 1, po_id: 1, product_id: 100, product_name: 'Sữa tươi', batch_id: null,
    quantity: 100, cost_price: 200000, total_price: 20000000
  }
};

module.exports = { mockSupplierRepo, mockPurchaseOrderRepo, mockPoDetailRepo, createMockPool, FIXTURES };
