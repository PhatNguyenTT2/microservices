const bcrypt = require('bcrypt');
const { ValidationError, NotFoundError, ConflictError } = require('../../../../shared/common/errors');

/**
 * Transform flat DB row → monolithic-compatible nested format.
 * Frontend expects: { id, fullName, phone, address, dateOfBirth, userAccount: { ... } }
 */
function transformEmployee(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    phone: row.phone || null,
    address: row.address || null,
    dateOfBirth: row.dob || null,
    gender: row.gender || null,
    storeId: row.store_id || null,
    storeName: row.store_name || null,
    userAccount: {
      id: row.id,
      username: row.username,
      email: row.email,
      userCode: `USR${String(row.id).padStart(3, '0')}`,
      isActive: row.is_active,
      lastLogin: row.last_login || null,
      role: {
        id: row.role_id,
        roleName: row.role_name
      }
    }
  };
}

class EmployeeService {
  constructor(employeeRepo, userRepo, authRepo, storeRepo, pool) {
    this.employeeRepo = employeeRepo;
    this.userRepo = userRepo;
    this.authRepo = authRepo;
    this.storeRepo = storeRepo;
    this.pool = pool;
  }

  async list(callerStoreId, filters) {
    if (callerStoreId) {
      filters = { ...filters, storeId: callerStoreId };
    }
    const rows = await this.employeeRepo.findAll(filters);
    const employees = rows.map(transformEmployee);
    return { employees, count: employees.length };
  }

  async getById(userId) {
    const row = await this.employeeRepo.findById(userId);
    if (!row) throw new NotFoundError('Employee not found');
    return { employee: transformEmployee(row) };
  }

  async create(callerStoreId, data) {
    // Support monolithic format: { userData, employeeData }
    let full_name, email, password, address, phone, gender, dob, role_id, pos_pin, store_id;

    if (data.userData && data.employeeData) {
      // Monolithic format
      email = data.userData.email;
      password = data.userData.password;
      role_id = data.userData.role;
      full_name = data.employeeData.fullName;
      phone = data.employeeData.phone;
      address = data.employeeData.address;
      dob = data.employeeData.dateOfBirth;
      gender = data.employeeData.gender;
      store_id = data.store_id;
    } else {
      // Flat format
      ({ full_name, email, password, address, phone, gender, dob, role_id, pos_pin, store_id } = data);
    }
    
    if (!full_name || !email || !password || !role_id) {
      throw new ValidationError('full_name, email, password, and role_id are required');
    }

    // Store Admin can only create employees for their own store
    if (callerStoreId) {
      store_id = callerStoreId;
    }

    // If no store_id and no callerStoreId, allow null (HQ employee)
    if (store_id) {
      const storeExists = await this.storeRepo.findById(store_id);
      if (!storeExists) throw new ValidationError(`Store ID ${store_id} does not exist`);
    }

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

      await this.employeeRepo.createProfile(client, newUser.id, store_id || null, {
         full_name, address, phone, gender, dob
      });

      if (pos_pin) {
        const pinHash = await bcrypt.hash(pos_pin, 10);
        await this.authRepo.createPosAuthWithClient(client, {
          userId: newUser.id, pinHash
        });
      }

      await client.query('COMMIT');

      // Return full employee with transformed format
      const created = await this.employeeRepo.findById(newUser.id);
      return { employee: transformEmployee(created) };
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

    // Map camelCase frontend fields to snake_case
    const mappedData = {
      full_name: data.fullName || data.full_name,
      address: data.address,
      phone: data.phone,
      gender: data.gender,
      dob: data.dateOfBirth || data.dob,
      store_id: data.store_id,
      role_id: data.role_id,
      is_active: data.is_active,
      pos_pin: data.pos_pin
    };

    const client = await this.pool.connect();
    try {
         await client.query('BEGIN');
         
         if (mappedData.store_id) {
              const storeExists = await this.storeRepo.findById(mappedData.store_id);
              if (!storeExists) throw new ValidationError(`Store ID ${mappedData.store_id} does not exist`);
         }

         if (mappedData.pos_pin) {
            const pinHash = await bcrypt.hash(mappedData.pos_pin, 10);
            await this.authRepo.upsertPosAuthWithClient(client, { userId, pinHash });
         }

         if (mappedData.role_id) {
            await this.userRepo.updateRoleWithClient(client, userId, mappedData.role_id);
         }

         if (mappedData.is_active !== undefined) {
             await this.userRepo.setActiveWithClient(client, userId, mappedData.is_active);
         }

         await this.employeeRepo.updateProfile(
           client, userId,
           mappedData.store_id || existing.store_id,
           mappedData
         );
         
         await client.query('COMMIT');

         // Return full refreshed employee
         const updated = await this.employeeRepo.findById(userId);
         return { employee: transformEmployee(updated) };
    } catch(err) {
         await client.query('ROLLBACK');
         throw err;
    } finally {
         client.release();
    }
  }

  async delete(userId) {
    const existing = await this.employeeRepo.findById(userId);
    if (!existing) throw new NotFoundError('Employee not found');

    // Must deactivate before deleting
    if (existing.is_active) {
      throw new ValidationError('Cannot delete an active employee. Please deactivate the account first.');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Delete employee profile (CASCADE will handle user_account via FK)
      await client.query('DELETE FROM employee WHERE user_id = $1', [userId]);
      // Deactivate and clear tokens
      await client.query('DELETE FROM auth_tokens WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM pos_auth WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM user_account WHERE id = $1', [userId]);
      await client.query('COMMIT');
      return { message: 'Employee deleted successfully' };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

module.exports = EmployeeService;

