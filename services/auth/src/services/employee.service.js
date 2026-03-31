const bcrypt = require('bcrypt');
const { ValidationError, NotFoundError, ConflictError } = require('../../../../shared/common/errors');

class EmployeeService {
  constructor(employeeRepo, userRepo, authRepo, storeRepo, pool) {
    this.employeeRepo = employeeRepo;
    this.userRepo = userRepo;
    this.authRepo = authRepo;
    this.storeRepo = storeRepo;
    this.pool = pool;
  }

  async list(callerStoreId, filters) {
    // Chain Owner (storeId = null) sees all employees
    // Store Admin sees only employees in their store
    if (callerStoreId) {
      return this.employeeRepo.findAll({ ...filters, storeId: callerStoreId });
    }
    return this.employeeRepo.findAll(filters);
  }

  async getById(userId) {
    const employee = await this.employeeRepo.findById(userId);
    if (!employee) throw new NotFoundError('Employee not found');
    return employee;
  }

  async create(callerStoreId, data) {
    let { full_name, email, password, address, phone, gender, dob, role_id, pos_pin, store_id } = data;
    
    if (!full_name || !email || !password || !role_id) {
      throw new ValidationError('full_name, email, password, and role_id are required');
    }

    // Store Admin can only create employees for their own store
    if (callerStoreId) {
      store_id = callerStoreId;
    }

    // Chain Owner must provide store_id explicitly
    if (!store_id) {
      throw new ValidationError('store_id is required');
    }

    const storeExists = await this.storeRepo.findById(store_id);
    if (!storeExists) throw new ValidationError(`Store ID ${store_id} does not exist`);

    const existingEmail = await this.userRepo.findByEmail(email);
    if (existingEmail) throw new ConflictError('Email already exists');

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const passwordHash = await bcrypt.hash(password, 10);
      const username = email.split('@')[0];

      const existingUsername = await this.userRepo.findByUsername(username);
      const finalUsername = existingUsername ? `${username}_${Date.now().toString(36)}` : username;

      const newUser = await this.userRepo.createWithClient(client, {
        username: finalUsername, email, passwordHash, roleId: role_id
      });

      const employee = await this.employeeRepo.createProfile(client, newUser.id, store_id, {
         full_name, address, phone, gender, dob
      });

      if (pos_pin) {
        const pinHash = await bcrypt.hash(pos_pin, 10);
        await this.authRepo.createPosAuthWithClient(client, {
          userId: newUser.id, pinHash
        });
      }

      await client.query('COMMIT');

      return {
        ...employee,
        username: newUser.username,
        email: newUser.email,
        is_active: true
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async update(userId, data) {
    const existing = await this.employeeRepo.findById(userId);
    if (!existing) throw new NotFoundError('Employee not found');

    const client = await this.pool.connect();
    try {
         await client.query('BEGIN');
         
         if (data.store_id) {
              const storeExists = await this.storeRepo.findById(data.store_id);
              if (!storeExists) throw new ValidationError(`Store ID ${data.store_id} does not exist`);
         }

         if (data.pos_pin) {
            const pinHash = await bcrypt.hash(data.pos_pin, 10);
            await this.authRepo.upsertPosAuthWithClient(client, { userId, pinHash });
         }

         if (data.role_id) {
            await this.userRepo.updateRoleWithClient(client, userId, data.role_id);
         }

         if (data.is_active !== undefined) {
             await this.userRepo.setActiveWithClient(client, userId, data.is_active);
         }

         const updatedProfile = await this.employeeRepo.updateProfile(client, userId, data.store_id || existing.store_id, data);
         
         await client.query('COMMIT');
         return updatedProfile;
    } catch(err) {
         await client.query('ROLLBACK');
         throw err;
    } finally {
         client.release();
    }
  }
}

module.exports = EmployeeService;
