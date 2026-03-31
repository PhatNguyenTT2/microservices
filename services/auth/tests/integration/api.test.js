/**
 * Integration Tests: Auth API Endpoints
 * Tests HTTP layer with mocked services via dependency injection.
 * Shared modules are mocked via jest.config.js moduleNameMapper.
 */

const request = require('supertest');
const createApp = require('../../src/app');
const { UnauthorizedError, ValidationError } = require('../../../../shared/common/errors');

describe('Auth API Integration', () => {
  let app, authService, customerService, employeeService, rbacService, storeService;

  beforeEach(() => {
    authService = {
      login: jest.fn(),
      registerTrial: jest.fn(),
      registerCustomer: jest.fn(),
      logout: jest.fn(),
      getMe: jest.fn(),
      posLogin: jest.fn()
    };
    customerService = { list: jest.fn(), getById: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() };
    employeeService = { list: jest.fn(), getById: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() };
    rbacService = { listRoles: jest.fn(), getRoleById: jest.fn(), createRole: jest.fn(), updateRole: jest.fn(), deleteRole: jest.fn(), listPermissions: jest.fn() };
    storeService = { getStores: jest.fn(), getStore: jest.fn(), createStore: jest.fn(), updateStore: jest.fn() };

    app = createApp({ authService, customerService, employeeService, rbacService, storeService });
  });

  // === Auth ===
  describe('POST /api/auth/login', () => {
    it('should return 200 with token on valid login', async () => {
      authService.login.mockResolvedValue({
        token: 'jwt-123',
        user: { id: 1, username: 'admin', role: 'Super Admin', storeId: 1 }
      });

      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'admin', password: 'password123' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.token).toBe('jwt-123');
    });

    it('should return 401 on invalid credentials', async () => {
      authService.login.mockRejectedValue(new UnauthorizedError('Invalid username or password'));

      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'wrong', password: 'wrong' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/auth/register-trial', () => {
    it('should return 201 on successful trial registration', async () => {
      authService.registerTrial.mockResolvedValue({
        id: 10, username: 'newuser', email: 'new@test.com', role: 'Super Admin',
        store: { id: 1, name: 'My Store' }
      });

      const res = await request(app)
        .post('/api/auth/register-trial')
        .send({ username: 'newuser', email: 'new@test.com', fullName: 'New', password: 'pass123', storeName: 'My Store' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.username).toBe('newuser');
      expect(res.body.data.store.name).toBe('My Store');
    });

    it('should return 400 on validation error', async () => {
      authService.registerTrial.mockRejectedValue(new ValidationError('All fields required'));

      const res = await request(app)
        .post('/api/auth/register-trial')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/auth/register-customer', () => {
    it('should return 201 with token on successful customer registration', async () => {
      authService.registerCustomer.mockResolvedValue({
        token: 'customer-jwt',
        user: { id: 20, username: 'john_abc', email: 'john@test.com', role: 'Customer' }
      });

      const res = await request(app)
        .post('/api/auth/register-customer')
        .send({ fullName: 'John', email: 'john@test.com', password: 'pass123' });

      expect(res.status).toBe(201);
      expect(res.body.data.token).toBe('customer-jwt');
      expect(res.body.data.user.role).toBe('Customer');
    });

    it('should return 400 on validation error', async () => {
      authService.registerCustomer.mockRejectedValue(new ValidationError('fullName, email, and password are required'));

      const res = await request(app)
        .post('/api/auth/register-customer')
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/auth/me', () => {
    it('should return user profile with valid token', async () => {
      authService.getMe.mockResolvedValue({
        id: 1, username: 'admin', role: 'Super Admin', storeId: 1
      });

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.data.username).toBe('admin');
    });

    it('should return 401 without token', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should return 200 on logout', async () => {
      authService.logout.mockResolvedValue();

      const res = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.data.message).toBe('Logged out successfully');
    });
  });

  // === Customer CRUD ===
  describe('GET /api/customers', () => {
    it('should return paginated customers', async () => {
      customerService.list.mockResolvedValue({ items: [{ id: 1 }], total: 1 });

      const res = await request(app)
        .get('/api/customers')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.pagination).toBeDefined();
    });
  });

  describe('POST /api/customers', () => {
    it('should create customer and return 201', async () => {
      customerService.create.mockResolvedValue({ user_id: 10, full_name: 'New' });

      const res = await request(app)
        .post('/api/customers')
        .set('Authorization', 'Bearer valid-token')
        .send({ fullName: 'New', email: 'n@t.com', password: 'pass123' });

      expect(res.status).toBe(201);
    });
  });

  // === Employee ===
  describe('GET /api/employees', () => {
    it('should return paginated employees', async () => {
      employeeService.list.mockResolvedValue({ items: [{ user_id: 1 }], total: 1 });

      const res = await request(app)
        .get('/api/employees')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.pagination).toBeDefined();
    });
  });

  // === Store (requires auth) ===
  describe('GET /api/stores', () => {
    it('should return stores with valid token', async () => {
      storeService.getStores.mockResolvedValue([{ id: 1, name: 'Store 1' }]);

      const res = await request(app)
        .get('/api/stores')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.data.stores).toHaveLength(1);
    });

    it('should return 401 without token', async () => {
      const res = await request(app).get('/api/stores');
      expect(res.status).toBe(401);
    });
  });

  // === RBAC ===
  describe('GET /api/roles', () => {
    it('should return all roles', async () => {
      rbacService.listRoles.mockResolvedValue([{ id: 1, name: 'Admin' }]);

      const res = await request(app)
        .get('/api/roles')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });
  });

  describe('GET /api/permissions', () => {
    it('should return all permissions', async () => {
      rbacService.listPermissions.mockResolvedValue([{ id: 1, code: 'dashboard.view' }]);

      const res = await request(app)
        .get('/api/permissions')
        .set('Authorization', 'Bearer valid-token');

      expect(res.status).toBe(200);
    });
  });

  // === Health ===
  describe('GET /health', () => {
    it('should return ok', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });
});
