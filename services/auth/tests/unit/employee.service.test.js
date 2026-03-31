/**
 * Unit Tests: EmployeeService
 * Tests CRUD + POS PIN logic + Store assignments with mocked repositories.
 */

const EmployeeService = require('../../src/services/employee.service');
const { mockEmployeeRepo, mockUserRepo, mockAuthRepo, createMockPool, FIXTURES } = require('../helpers');

describe('EmployeeService', () => {
  let service, employeeRepo, userRepo, authRepo, storeRepo, pool;

  beforeEach(() => {
    employeeRepo = mockEmployeeRepo();
    // override mocked methods to match new signatures
    employeeRepo.createProfile = jest.fn();
    employeeRepo.updateProfile = jest.fn();
    employeeRepo.findById = jest.fn();
    
    userRepo = mockUserRepo();
    userRepo.updateRoleWithClient = jest.fn();
    userRepo.setActiveWithClient = jest.fn();
    
    authRepo = mockAuthRepo();
    authRepo.upsertPosAuthWithClient = jest.fn();
    
    storeRepo = {
      findById: jest.fn()
    };
    
    pool = createMockPool();
    // Need to reset pool mock query mapping
    pool._client.query = jest.fn();
    
    service = new EmployeeService(employeeRepo, userRepo, authRepo, storeRepo, pool);
  });

  describe('create()', () => {
    const validData = {
        full_name: 'New Emp', email: 'e@t.com', password: 'pass123', role_id: 1, store_id: 10
    };

    it('should create employee with user_account in transaction', async () => {
      storeRepo.findById.mockResolvedValue({ id: 10 });
      userRepo.findByEmail.mockResolvedValue(null);
      userRepo.findByUsername.mockResolvedValue(null);
      userRepo.createWithClient.mockResolvedValue({ id: 5, username: 'emp1', email: 'e@t.com', is_active: true });
      employeeRepo.createProfile.mockResolvedValue({ user_id: 5, full_name: 'New Emp' });

      const result = await service.create(null, validData);

      expect(result.full_name).toBe('New Emp');
      expect(pool._client.query).toHaveBeenCalledWith('COMMIT');
    });

    it('should throw ValidationError if store does not exist', async () => {
      storeRepo.findById.mockResolvedValue(null); // store 10 not found
      
      await expect(service.create(null, validData))
        .rejects.toThrow('Store ID 10 does not exist');
      
      expect(pool.connect).not.toHaveBeenCalled();
    });

    it('should throw ValidationError when expected fields missing', async () => {
      await expect(service.create(null, { full_name: 'A' }))
        .rejects.toThrow('full_name, email, password, and role_id are required');
    });

    it('should setup POS auth when pos_pin provided', async () => {
      storeRepo.findById.mockResolvedValue({ id: 10 });
      userRepo.findByEmail.mockResolvedValue(null);
      userRepo.findByUsername.mockResolvedValue(null);
      userRepo.createWithClient.mockResolvedValue({ id: 5, username: 'emp1', email: 'e@t.com', is_active: true });
      employeeRepo.createProfile.mockResolvedValue({ user_id: 5, full_name: 'Emp' });
      authRepo.createPosAuthWithClient.mockResolvedValue({});

      await service.create(null, { ...validData, pos_pin: '1234' });

      expect(authRepo.createPosAuthWithClient).toHaveBeenCalled();
    });
  });

  describe('update()', () => {
    it('should update employee profile', async () => {
      employeeRepo.findById.mockResolvedValue({ ...FIXTURES.employee, store_id: 10 });
      storeRepo.findById.mockResolvedValue({ id: 20 }); // newly changing to store 20 
      employeeRepo.updateProfile.mockResolvedValue({ ...FIXTURES.employee, full_name: 'Updated' });

      const result = await service.update(1, { full_name: 'Updated', store_id: 20 });
      
      expect(storeRepo.findById).toHaveBeenCalledWith(20);
      expect(employeeRepo.updateProfile).toHaveBeenCalled();
      expect(result.full_name).toBe('Updated');
    });

    it('should update POS PIN in transaction if provided', async () => {
      employeeRepo.findById.mockResolvedValue(FIXTURES.employee);
      employeeRepo.updateProfile.mockResolvedValue(FIXTURES.employee);

      await service.update(1, { pos_pin: '5678' });
      expect(authRepo.upsertPosAuthWithClient).toHaveBeenCalled();
    });

    it('should update role if role_id provided', async () => {
      employeeRepo.findById.mockResolvedValue(FIXTURES.employee);
      employeeRepo.updateProfile.mockResolvedValue(FIXTURES.employee);

      await service.update(1, { role_id: 2 });
      expect(userRepo.updateRoleWithClient).toHaveBeenCalled();
    });

    it('should throw NotFoundError when employee not found', async () => {
      employeeRepo.findById.mockResolvedValue(null);

      await expect(service.update(999, { full_name: 'X' }))
        .rejects.toThrow('Employee not found');
    });
  });
});
