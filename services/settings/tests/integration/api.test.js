const request = require('supertest');
const createApp = require('../../src/app');

describe('Settings API Integration', () => {
  let app, settingsService;

  beforeEach(() => {
    settingsService = {
      getSecuritySettings: jest.fn(),
      updateSecuritySettings: jest.fn(),
      getSalesSettings: jest.fn(),
      updateSalesSettings: jest.fn(),
      getHistory: jest.fn()
    };
    app = createApp({ settingsService });
  });

  // --- Security ---
  describe('GET /api/settings/security', () => {
    it('should get security settings', async () => {
      settingsService.getSecuritySettings.mockResolvedValue({ id: 1, max_failed_attempts: 5 });
      const res = await request(app).get('/api/settings/security').set('Authorization', 'Bearer t');
      expect(res.status).toBe(200);
      expect(res.body.data.max_failed_attempts).toBe(5);
    });
  });

  describe('PUT /api/settings/security', () => {
    it('should update security settings with reason', async () => {
      settingsService.updateSecuritySettings.mockResolvedValue({ id: 1, max_failed_attempts: 10 });
      const res = await request(app).put('/api/settings/security').set('Authorization', 'Bearer t')
        .send({ max_failed_attempts: 10, change_reason: 'Testing update' });
      expect(res.status).toBe(200);
    });
  });

  // --- Sales ---
  describe('GET /api/settings/sales', () => {
    it('should get sales settings', async () => {
      settingsService.getSalesSettings.mockResolvedValue({ id: 1, discount_vip: 15 });
      const res = await request(app).get('/api/settings/sales').set('Authorization', 'Bearer t');
      expect(res.status).toBe(200);
    });
  });

  describe('PUT /api/settings/sales', () => {
    it('should update sales settings with reason', async () => {
      settingsService.updateSalesSettings.mockResolvedValue({ id: 1, discount_vip: 20 });
      const res = await request(app).put('/api/settings/sales').set('Authorization', 'Bearer t')
        .send({ discount_vip: 20, change_reason: 'Testing sales update' });
      expect(res.status).toBe(200);
    });
  });

  // --- History ---
  describe('GET /api/settings/history', () => {
    it('should get paginated history', async () => {
      settingsService.getHistory.mockResolvedValue({ items: [], total: 0 });
      const res = await request(app).get('/api/settings/history').set('Authorization', 'Bearer t');
      expect(res.status).toBe(200);
      expect(res.body.pagination).toBeDefined();
    });
  });

  // --- Global ---
  describe('GET /health', () => {
    it('should return ok', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
    });
  });
});
