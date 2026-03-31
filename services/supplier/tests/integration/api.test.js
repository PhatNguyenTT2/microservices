const request = require('supertest');
const createApp = require('../../src/app');

describe('Supplier API Integration', () => {
  let app, supplierService, poService;

  beforeEach(() => {
    supplierService = { 
      list: jest.fn(), getById: jest.fn(), create: jest.fn(), 
      update: jest.fn(), getDebtInfo: jest.fn() 
    };
    poService = { 
      getStorePurchaseOrders: jest.fn(), getPurchaseOrderById: jest.fn(), createDraftPO: jest.fn(), 
      updateStatus: jest.fn() 
    };

    app = createApp({ supplierService, poService });
  });

  // === Suppliers ===
  describe('GET /api/suppliers', () => {
    it('should return paginated suppliers', async () => {
      supplierService.list.mockResolvedValue({ items: [{ id: 1 }], total: 1 });
      const res = await request(app).get('/api/suppliers').set('Authorization', 'Bearer t');
      expect(res.status).toBe(200);
      expect(res.body.pagination).toBeDefined();
    });
  });

  describe('POST /api/suppliers', () => {
    it('should create supplier', async () => {
      supplierService.create.mockResolvedValue({ id: 1, company_name: 'Vinamilk' });
      const res = await request(app).post('/api/suppliers').set('Authorization', 'Bearer t')
        .send({ company_name: 'Vinamilk' });
      expect(res.status).toBe(201);
    });
  });

  describe('GET /api/suppliers/:id/debt', () => {
    it('should return debt info', async () => {
      supplierService.getDebtInfo.mockResolvedValue({ current_debt: 100 });
      const res = await request(app).get('/api/suppliers/1/debt').set('Authorization', 'Bearer t');
      expect(res.status).toBe(200);
      expect(res.body.data.current_debt).toBe(100);
    });
  });

  // === Purchase Orders ===
  describe('POST /api/purchase-orders', () => {
    it('should create PO', async () => {
      poService.createDraftPO.mockResolvedValue({ id: 1, status: 'draft' });
      const res = await request(app).post('/api/purchase-orders').set('Authorization', 'Bearer t')
        .send({ supplier_id: 1, items: [{ product_id: 1, product_name: 'A', quantity: 1, cost_price: 100 }] });
      expect(res.status).toBe(201);
    });
  });

  describe('PATCH /api/purchase-orders/:id/status', () => {
    it('should update status', async () => {
      poService.updateStatus.mockResolvedValue({ id: 1, status: 'pending' });
      const res = await request(app).patch('/api/purchase-orders/1/status').set('Authorization', 'Bearer t')
        .send({ status: 'pending' });
      expect(res.status).toBe(200);
    });
  });

  // === Auth Guard ===
  describe('Unauthorized access', () => {
    it('should return 401 without token', async () => {
      const res = await request(app).get('/api/suppliers');
      expect(res.status).toBe(401);
    });
  });
});
