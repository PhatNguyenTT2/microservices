/**
 * Unit Tests: AuthService
 * Tests business logic with mocked repositories.
 */

const AuthService = require('../../src/services/auth.service');
const { mockUserRepo, mockAuthRepo, mockEmployeeRepo, mockCustomerRepo, mockRoleRepo, mockStoreRepo, createMockPool, FIXTURES } = require('../helpers');

describe('AuthService', () => {
  let authService, userRepo, authRepo, employeeRepo, customerRepo, roleRepo, storeRepo, pool;

  beforeEach(() => {
    userRepo = mockUserRepo();
    authRepo = mockAuthRepo();
    employeeRepo = mockEmployeeRepo();
    customerRepo = mockCustomerRepo();
    roleRepo = mockRoleRepo();
    storeRepo = mockStoreRepo();
    pool = createMockPool();
    authService = new AuthService({ userRepo, authRepo, employeeRepo, customerRepo, roleRepo, storeRepo, pool });
  });

  // === login ===
  describe('login()', () => {
    it('should return token and user data with storeId on valid credentials', async () => {
      userRepo.findByUsernameOrEmail.mockResolvedValue(FIXTURES.user);
      userRepo.getPermissions.mockResolvedValue(FIXTURES.permissions);
      employeeRepo.findByUserId.mockResolvedValue(FIXTURES.employee);

      const result = await authService.login({ username: 'admin', password: 'password123' });

      expect(result.token).toBe('mock-jwt-token');
      expect(result.user.id).toBe(1);
      expect(result.user.role).toBe('Super Admin');
      expect(result.user.storeId).toBe(1);
      expect(result.user.permissions).toEqual(FIXTURES.permissions);
      expect(userRepo.updateLastLogin).toHaveBeenCalledWith(1);
      expect(authRepo.saveToken).toHaveBeenCalled();
    });

    it('should throw ValidationError when credentials missing', async () => {
      await expect(authService.login({ username: '', password: '' }))
        .rejects.toThrow('Username and password are required');
    });

    it('should throw UnauthorizedError when user not found', async () => {
      userRepo.findByUsernameOrEmail.mockResolvedValue(null);

      await expect(authService.login({ username: 'nobody', password: 'pass' }))
        .rejects.toThrow('Invalid username or password');
    });

    it('should throw UnauthorizedError when account is inactive', async () => {
      userRepo.findByUsernameOrEmail.mockResolvedValue(FIXTURES.inactiveUser);

      await expect(authService.login({ username: 'inactive', password: 'password123' }))
        .rejects.toThrow('Account is inactive');
    });

    it('should throw UnauthorizedError on wrong password', async () => {
      userRepo.findByUsernameOrEmail.mockResolvedValue(FIXTURES.user);

      await expect(authService.login({ username: 'admin', password: 'wrongpass' }))
        .rejects.toThrow('Invalid username or password');
    });
  });

  // === registerTrial ===
  describe('registerTrial()', () => {
    it('should create user, store, and employee in one transaction', async () => {
      userRepo.findByUsername.mockResolvedValue(null);
      userRepo.findByEmail.mockResolvedValue(null);
      roleRepo.findByName.mockResolvedValue({ id: 1, name: 'Super Admin' });
      userRepo.createWithClient.mockResolvedValue({
        id: 10, username: 'newadmin', email: 'new@test.com'
      });
      storeRepo.createWithClient.mockResolvedValue({
        id: 5, name: 'My Store'
      });
      employeeRepo.createProfile.mockResolvedValue({
        user_id: 10, store_id: 5, full_name: 'New Admin'
      });

      const result = await authService.registerTrial({
        username: 'newadmin', email: 'new@test.com',
        fullName: 'New Admin', password: 'password123',
        storeName: 'My Store'
      });

      expect(result.username).toBe('newadmin');
      expect(result.role).toBe('Super Admin');
      expect(result.store.id).toBe(5);
      expect(result.store.name).toBe('My Store');
      expect(pool._client.query).toHaveBeenCalledWith('BEGIN');
      expect(pool._client.query).toHaveBeenCalledWith('COMMIT');
      expect(storeRepo.createWithClient).toHaveBeenCalledWith(pool._client, expect.objectContaining({
        name: 'My Store', manager_id: 10
      }));
      expect(employeeRepo.createProfile).toHaveBeenCalledWith(pool._client, 10, 5, expect.objectContaining({
        full_name: 'New Admin'
      }));
    });

    it('should throw ValidationError when fields missing', async () => {
      await expect(authService.registerTrial({ username: 'a' }))
        .rejects.toThrow('All fields required');
    });

    it('should throw ValidationError when storeName missing', async () => {
      await expect(authService.registerTrial({
        username: 'a', email: 'a@b.com', fullName: 'A', password: 'password123'
      })).rejects.toThrow('storeName is required');
    });

    it('should throw ValidationError when password too short', async () => {
      await expect(authService.registerTrial({
        username: 'a', email: 'a@b.com', fullName: 'A', password: '12345', storeName: 'S'
      })).rejects.toThrow('Password must be at least 6 characters');
    });

    it('should throw ConflictError when username exists', async () => {
      userRepo.findByUsername.mockResolvedValue(FIXTURES.user);

      await expect(authService.registerTrial({
        username: 'admin', email: 'new@test.com', fullName: 'A', password: 'password123', storeName: 'S'
      })).rejects.toThrow('Username already exists');
    });

    it('should throw ConflictError when email exists', async () => {
      userRepo.findByUsername.mockResolvedValue(null);
      userRepo.findByEmail.mockResolvedValue(FIXTURES.user);

      await expect(authService.registerTrial({
        username: 'newuser', email: 'admin@test.com', fullName: 'A', password: 'password123', storeName: 'S'
      })).rejects.toThrow('Email already exists');
    });

    it('should rollback transaction on error', async () => {
      userRepo.findByUsername.mockResolvedValue(null);
      userRepo.findByEmail.mockResolvedValue(null);
      roleRepo.findByName.mockResolvedValue({ id: 1 });
      userRepo.createWithClient.mockRejectedValue(new Error('DB error'));

      await expect(authService.registerTrial({
        username: 'a', email: 'a@b.com', fullName: 'A', password: 'password123', storeName: 'S'
      })).rejects.toThrow('DB error');

      expect(pool._client.query).toHaveBeenCalledWith('ROLLBACK');
      expect(pool._client.release).toHaveBeenCalled();
    });
  });

  // === registerCustomer ===
  describe('registerCustomer()', () => {
    it('should create customer with auto-login token', async () => {
      userRepo.findByEmail.mockResolvedValue(null);
      roleRepo.findByName.mockResolvedValue({ id: 3, name: 'Customer' });
      userRepo.createWithClient.mockResolvedValue({ id: 20, username: 'john_test', email: 'john@test.com' });
      customerRepo.create.mockResolvedValue({ user_id: 20, full_name: 'John' });
      userRepo.getPermissions.mockResolvedValue([]);

      const result = await authService.registerCustomer({
        fullName: 'John', email: 'john@test.com', password: 'pass123'
      });

      expect(result.token).toBe('mock-jwt-token');
      expect(result.user.role).toBe('Customer');
      expect(result.user.email).toBe('john@test.com');
      expect(pool._client.query).toHaveBeenCalledWith('COMMIT');
    });

    it('should throw ValidationError when fields missing', async () => {
      await expect(authService.registerCustomer({ fullName: 'A' }))
        .rejects.toThrow('fullName, email, and password are required');
    });

    it('should throw ConflictError when email exists', async () => {
      userRepo.findByEmail.mockResolvedValue(FIXTURES.user);

      await expect(authService.registerCustomer({
        fullName: 'A', email: 'admin@test.com', password: 'pass123'
      })).rejects.toThrow('Email already exists');
    });

    it('should rollback on error', async () => {
      userRepo.findByEmail.mockResolvedValue(null);
      roleRepo.findByName.mockResolvedValue({ id: 3 });
      userRepo.createWithClient.mockRejectedValue(new Error('DB error'));

      await expect(authService.registerCustomer({
        fullName: 'A', email: 'a@b.com', password: 'pass123'
      })).rejects.toThrow('DB error');

      expect(pool._client.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  // === logout ===
  describe('logout()', () => {
    it('should delete token hash', async () => {
      await authService.logout('some-jwt-token');
      expect(authRepo.deleteToken).toHaveBeenCalled();
    });
  });

  // === getMe ===
  describe('getMe()', () => {
    it('should return user profile with storeId', async () => {
      userRepo.findById.mockResolvedValue(FIXTURES.user);
      userRepo.getPermissions.mockResolvedValue(FIXTURES.permissions);
      employeeRepo.findByUserId.mockResolvedValue(FIXTURES.employee);

      const result = await authService.getMe(1);

      expect(result.username).toBe('admin');
      expect(result.storeId).toBe(1);
      expect(result.isActive).toBe(true);
      expect(result.permissions).toEqual(FIXTURES.permissions);
    });

    it('should throw when user not found', async () => {
      userRepo.findById.mockResolvedValue(null);

      await expect(authService.getMe(999))
        .rejects.toThrow('User not found or inactive');
    });
  });

  // === posLogin ===
  describe('posLogin()', () => {
    it('should return token on valid PIN', async () => {
      userRepo.findByUsername.mockResolvedValue(FIXTURES.user);
      authRepo.findPosAuth.mockResolvedValue(FIXTURES.posAuth);
      userRepo.getPermissions.mockResolvedValue(FIXTURES.permissions);
      employeeRepo.findByUserId.mockResolvedValue(FIXTURES.employee);

      const result = await authService.posLogin({ employeeCode: 'admin', pin: '1234' });

      expect(result.token).toBe('mock-jwt-token');
      expect(authRepo.resetPosFailedAttempts).toHaveBeenCalledWith(1);
    });

    it('should throw when POS not enabled', async () => {
      userRepo.findByUsername.mockResolvedValue(FIXTURES.user);
      authRepo.findPosAuth.mockResolvedValue({ ...FIXTURES.posAuth, is_enabled: false });

      await expect(authService.posLogin({ employeeCode: 'admin', pin: '1234' }))
        .rejects.toThrow('POS access not enabled');
    });

    it('should throw when account locked', async () => {
      userRepo.findByUsername.mockResolvedValue(FIXTURES.user);
      authRepo.findPosAuth.mockResolvedValue({
        ...FIXTURES.posAuth,
        locked_until: new Date(Date.now() + 900000)
      });

      await expect(authService.posLogin({ employeeCode: 'admin', pin: '1234' }))
        .rejects.toThrow('Account locked');
    });

    it('should increment failed attempts on wrong PIN', async () => {
      userRepo.findByUsername.mockResolvedValue(FIXTURES.user);
      authRepo.findPosAuth.mockResolvedValue(FIXTURES.posAuth);

      await expect(authService.posLogin({ employeeCode: 'admin', pin: '9999' }))
        .rejects.toThrow('Invalid employee code or PIN');

      expect(authRepo.incrementPosFailedAttempts).toHaveBeenCalledWith(1);
    });
  });
});
