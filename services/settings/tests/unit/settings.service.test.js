const SettingsService = require('../../src/services/settings.service');
const { mockSecurityRepo, mockSalesRepo, mockHistoryRepo, createMockPool, FIXTURES } = require('../helpers');

describe('SettingsService', () => {
  let service, securityRepo, salesRepo, historyRepo, pool;

  beforeEach(() => {
    securityRepo = mockSecurityRepo();
    salesRepo = mockSalesRepo();
    historyRepo = mockHistoryRepo();
    pool = createMockPool();
    service = new SettingsService({
      securitySettingsRepo: securityRepo,
      salesSettingsRepo: salesRepo,
      historyRepo, pool
    });
  });

  describe('updateSecuritySettings() — Zone 1 Transaction', () => {
    it('should update and log history atomically', async () => {
      securityRepo.get.mockResolvedValue(FIXTURES.security);
      securityRepo.updateWithClient.mockResolvedValue({ ...FIXTURES.security, max_failed_attempts: 10 });
      
      const result = await service.updateSecuritySettings({ max_failed_attempts: 10 }, 1, 'Tighten security');
      
      expect(pool._client.query).toHaveBeenCalledWith('BEGIN');
      expect(securityRepo.updateWithClient).toHaveBeenCalled();
      expect(historyRepo.createWithClient).toHaveBeenCalledWith(
        pool._client,
        expect.objectContaining({ setting_type: 'security', change_reason: 'Tighten security' })
      );
      expect(pool._client.query).toHaveBeenCalledWith('COMMIT');
      expect(result.max_failed_attempts).toBe(10);
    });

    it('should require change_reason', async () => {
      await expect(service.updateSecuritySettings({ max_failed_attempts: 10 }, 1))
        .rejects.toThrow('Change reason is required');
    });

    it('should reject if no valid fields provided', async () => {
      await expect(service.updateSecuritySettings({ invalid_field: 'foo' }, 1, 'reason'))
        .rejects.toThrow('No valid settings fields');
    });

    it('should rollback on error', async () => {
      securityRepo.get.mockResolvedValue(FIXTURES.security);
      securityRepo.updateWithClient.mockRejectedValue(new Error('DB error'));
      
      await expect(service.updateSecuritySettings({ max_failed_attempts: 10 }, 1, 'reason'))
        .rejects.toThrow('DB error');
        
      expect(pool._client.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  describe('updateSalesSettings() — Zone 1 Transaction', () => {
    it('should update and log history atomically', async () => {
      salesRepo.get.mockResolvedValue(FIXTURES.sales);
      salesRepo.updateWithClient.mockResolvedValue({ ...FIXTURES.sales, auto_promotion_enabled: true });
      
      const result = await service.updateSalesSettings({ auto_promotion_enabled: true }, 1, 'Enable promo');
      
      expect(pool._client.query).toHaveBeenCalledWith('BEGIN');
      expect(salesRepo.updateWithClient).toHaveBeenCalled();
      expect(historyRepo.createWithClient).toHaveBeenCalledWith(
        pool._client,
        expect.objectContaining({ setting_type: 'sales', change_reason: 'Enable promo' })
      );
      expect(pool._client.query).toHaveBeenCalledWith('COMMIT');
      expect(result.auto_promotion_enabled).toBe(true);
    });

    it('should require change_reason', async () => {
      await expect(service.updateSalesSettings({ discount_vip: 20 }, 1))
        .rejects.toThrow('Change reason is required');
    });
  });

  describe('Queries', () => {
    it('getSecuritySettings', async () => {
      securityRepo.get.mockResolvedValue(FIXTURES.security);
      const res = await service.getSecuritySettings();
      expect(res.max_failed_attempts).toBe(5);
    });

    it('getSalesSettings', async () => {
      salesRepo.get.mockResolvedValue(FIXTURES.sales);
      const res = await service.getSalesSettings();
      expect(res.auto_promotion_enabled).toBe(false);
    });

    it('getHistory', async () => {
      historyRepo.findAll.mockResolvedValue({ items: [], total: 0 });
      const res = await service.getHistory({ settingType: 'sales' });
      expect(res.total).toBe(0);
    });
  });
});
