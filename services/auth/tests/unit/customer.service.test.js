/**
 * Unit Tests: CustomerService
 * Tests CRUD business logic with mocked repositories.
 */

const CustomerService = require('../../src/services/customer.service');
const { mockCustomerRepo, mockUserRepo, mockRoleRepo, createMockPool, FIXTURES } = require('../helpers');

describe('CustomerService', () => {
  let service, customerRepo, userRepo, roleRepo, pool;

  beforeEach(() => {
    customerRepo = mockCustomerRepo();
    userRepo = mockUserRepo();
    roleRepo = mockRoleRepo();
    pool = createMockPool();
    service = new CustomerService({ customerRepo, userRepo, roleRepo, pool });
  });

  // === list ===
  describe('list()', () => {
    it('should delegate to repository', async () => {
      const expected = { items: [FIXTURES.customer], total: 1 };
      customerRepo.findAll.mockResolvedValue(expected);

      const result = await service.list({ page: 1, limit: 10 });

      expect(result).toEqual(expected);
      expect(customerRepo.findAll).toHaveBeenCalledWith({ page: 1, limit: 10 });
    });
  });

  // === getById ===
  describe('getById()', () => {
    it('should return customer when found', async () => {
      customerRepo.findByUserId.mockResolvedValue(FIXTURES.customer);

      const result = await service.getById(3);
      expect(result.full_name).toBe('Customer Name');
    });

    it('should throw NotFoundError when not found', async () => {
      customerRepo.findByUserId.mockResolvedValue(null);

      await expect(service.getById(999)).rejects.toThrow('Customer not found');
    });
  });

  // === create ===
  describe('create()', () => {
    it('should create customer with user_account in transaction', async () => {
      userRepo.findByEmail.mockResolvedValue(null);
      roleRepo.findByName.mockResolvedValue({ id: 2, name: 'Customer' });
      userRepo.createWithClient.mockResolvedValue({ id: 10, username: 'cust_123', email: 'cust@test.com' });
      customerRepo.create.mockResolvedValue({ user_id: 10, full_name: 'New Customer' });

      const result = await service.create({
        fullName: 'New Customer', email: 'cust@test.com', password: 'pass123'
      });

      expect(result.full_name).toBe('New Customer');
      expect(pool._client.query).toHaveBeenCalledWith('BEGIN');
      expect(pool._client.query).toHaveBeenCalledWith('COMMIT');
    });

    it('should throw ValidationError when required fields missing', async () => {
      await expect(service.create({ fullName: 'Test' }))
        .rejects.toThrow('fullName, email, and password are required');
    });

    it('should throw ConflictError when email exists', async () => {
      userRepo.findByEmail.mockResolvedValue(FIXTURES.user);

      await expect(service.create({
        fullName: 'Test', email: 'admin@test.com', password: 'pass123'
      })).rejects.toThrow('Email already exists');
    });

    it('should create Customer role if not exists', async () => {
      userRepo.findByEmail.mockResolvedValue(null);
      roleRepo.findByName.mockResolvedValue(null);
      roleRepo.create.mockResolvedValue({ id: 99, name: 'Customer' });
      userRepo.createWithClient.mockResolvedValue({ id: 10, username: 'c', email: 'c@t.com' });
      customerRepo.create.mockResolvedValue({ user_id: 10 });

      await service.create({ fullName: 'T', email: 'c@t.com', password: 'pass123' });

      expect(roleRepo.create).toHaveBeenCalledWith({
        name: 'Customer', description: 'Customer role'
      });
    });

    it('should rollback on error', async () => {
      userRepo.findByEmail.mockResolvedValue(null);
      roleRepo.findByName.mockResolvedValue({ id: 2 });
      userRepo.createWithClient.mockRejectedValue(new Error('fail'));

      await expect(service.create({
        fullName: 'T', email: 'a@b.com', password: 'pass123'
      })).rejects.toThrow('fail');

      expect(pool._client.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  // === update ===
  describe('update()', () => {
    it('should update existing customer', async () => {
      customerRepo.findByUserId.mockResolvedValue(FIXTURES.customer);
      customerRepo.update.mockResolvedValue({ ...FIXTURES.customer, phone: '111111' });

      const result = await service.update(3, { phone: '111111' });
      expect(result.phone).toBe('111111');
    });

    it('should throw NotFoundError when customer not found', async () => {
      customerRepo.findByUserId.mockResolvedValue(null);

      await expect(service.update(999, { phone: '111' }))
        .rejects.toThrow('Customer not found');
    });
  });

  // === delete ===
  describe('delete()', () => {
    it('should delete existing customer', async () => {
      customerRepo.findByUserId.mockResolvedValue(FIXTURES.customer);
      customerRepo.delete.mockResolvedValue(true);

      const result = await service.delete(3);
      expect(result).toBe(true);
    });

    it('should throw NotFoundError when customer not found', async () => {
      customerRepo.findByUserId.mockResolvedValue(null);

      await expect(service.delete(999)).rejects.toThrow('Customer not found');
    });
  });
});
