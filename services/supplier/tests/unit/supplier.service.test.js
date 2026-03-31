const SupplierService = require('../../src/services/supplier.service');
const { mockSupplierRepo, FIXTURES } = require('../helpers');

describe('SupplierService', () => {
  let service, supplierRepo;

  beforeEach(() => {
    supplierRepo = mockSupplierRepo();
    service = new SupplierService({ supplierRepo });
  });

  describe('create()', () => {
    it('should create a new supplier', async () => {
      supplierRepo.findByName.mockResolvedValue(null);
      supplierRepo.create.mockResolvedValue(FIXTURES.supplier);

      const result = await service.create({ company_name: 'NewCo' });
      expect(result.company_name).toBe('Vinamilk'); // from fixture
      expect(supplierRepo.create).toHaveBeenCalled();
    });

    it('should reject missing company_name', async () => {
      await expect(service.create({})).rejects.toThrow('company_name is required');
    });

    it('should reject duplicate company_name', async () => {
      supplierRepo.findByName.mockResolvedValue(FIXTURES.supplier);
      await expect(service.create({ company_name: 'Vinamilk' }))
        .rejects.toThrow('already exists');
    });
  });

  describe('update()', () => {
    it('should update supplier and strip current_debt', async () => {
      supplierRepo.findById.mockResolvedValue(FIXTURES.supplier);
      supplierRepo.update.mockResolvedValue({ ...FIXTURES.supplier, address: 'New Address' });

      const result = await service.update(1, { address: 'New Address', current_debt: 999999 });
      
      expect(supplierRepo.update).toHaveBeenCalledWith(1, { address: 'New Address' }); // debt stripped
      expect(result.address).toBe('New Address');
    });

    it('should reject updating non-existent supplier', async () => {
      supplierRepo.findById.mockResolvedValue(null);
      await expect(service.update(99, {})).rejects.toThrow('not found');
    });
  });

  describe('getDebtInfo()', () => {
    it('should return calculated debt info', async () => {
      supplierRepo.findById.mockResolvedValue(FIXTURES.supplier); // limit 50m, debt 10m
      
      const result = await service.getDebtInfo(1);
      
      expect(result.credit_limit).toBe(50000000);
      expect(result.current_debt).toBe(10000000);
      expect(result.available_credit).toBe(40000000);
      expect(result.over_limit).toBe(false);
    });

    it('should return over_limit=true when debt > limit', async () => {
      supplierRepo.findById.mockResolvedValue({ 
        ...FIXTURES.supplier, credit_limit: 1000, current_debt: 5000 
      });
      
      const result = await service.getDebtInfo(1);
      expect(result.available_credit).toBe(0);
      expect(result.over_limit).toBe(true);
    });
  });
});
