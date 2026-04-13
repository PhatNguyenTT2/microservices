const bcrypt = require('bcrypt');
const { ValidationError, NotFoundError, ConflictError } = require('../../../../shared/common/errors');
const { SALT_ROUNDS } = require('../../../../shared/common/constants');

class CustomerService {
  constructor({ customerRepo, userRepo, roleRepo, pool }) {
    this.customerRepo = customerRepo;
    this.userRepo = userRepo;
    this.roleRepo = roleRepo;
    this.pool = pool;
  }

  /**
   * Get default guest customer for POS use.
   * Always returns a virtual walk-in customer placeholder.
   * Real customers (even with guest type) are individual people — not suitable as default.
   */
  async getDefaultGuest() {
    return {
      id: 'virtual-guest',
      fullName: 'Walk-in Customer',
      phone: '',
      customerType: 'guest',
      isVirtual: true,
      isActive: true
    };
  }

  /**
   * Format DB row → frontend-friendly object
   */
  formatCustomer(row) {
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id || null,
      fullName: row.full_name,
      phone: row.phone || '',
      address: row.address || '',
      gender: row.gender || '',
      dateOfBirth: row.dob || null,
      customerType: row.customer_type || 'retail',
      totalSpent: Number(row.total_spent) || 0,
      isActive: row.is_active !== false,
      // From user_account JOIN (if linked)
      username: row.username || null,
      email: row.email || '',
      hasAccount: !!row.user_id
    };
  }

  async list(query) {
    const result = await this.customerRepo.findAll(query);
    return {
      customers: result.items.map(row => this.formatCustomer(row)),
      pagination: {
        total: result.total,
        currentPage: parseInt(query.page) || 1,
        limit: parseInt(query.limit) || 20,
        totalPages: Math.ceil(result.total / (parseInt(query.limit) || 20))
      }
    };
  }

  async getById(id) {
    const customer = await this.customerRepo.findById(id);
    if (!customer) throw new NotFoundError('Customer');
    return this.formatCustomer(customer);
  }

  /**
   * Create customer
   * - With email + password: creates user_account + customer (linked)
   * - Without: creates customer only (walk-in)
   */
  async create({ fullName, email, password, phone, address, gender, dob, dateOfBirth, customerType }) {
    if (!fullName) {
      throw new ValidationError('fullName is required');
    }

    // Capitalize gender to match DB CHECK constraint (Male/Female/Other)
    const normalizedGender = gender ? gender.charAt(0).toUpperCase() + gender.slice(1).toLowerCase() : null;
    const normalizedDob = dateOfBirth || dob || null;

    // Walk-in customer (no account)
    if (!email || !password) {
      const customer = await this.customerRepo.create(null, {
        fullName, phone, address, gender: normalizedGender, dob: normalizedDob, customerType
      });
      return this.formatCustomer(customer);
    }

    // Customer with account
    const existingEmail = await this.userRepo.findByEmail(email);
    if (existingEmail) throw new ConflictError('Email already exists');

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      let role = await this.roleRepo.findByName('Customer');
      if (!role) {
        role = await this.roleRepo.create({ name: 'Customer', description: 'Customer role' });
      }

      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
      const username = email.split('@')[0] + '_' + Date.now().toString(36);

      const newUser = await this.userRepo.createWithClient(client, {
        username, email, passwordHash, roleId: role.id
      });

      const customer = await this.customerRepo.create(client, {
        userId: newUser.id, fullName, phone, address, gender: normalizedGender, dob: normalizedDob, customerType
      });

      await client.query('COMMIT');
      return this.formatCustomer({ ...customer, username: newUser.username, email: newUser.email });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async update(id, data) {
    const existing = await this.customerRepo.findById(id);
    if (!existing) throw new NotFoundError('Customer');

    const normalizedGender = data.gender ? data.gender.charAt(0).toUpperCase() + data.gender.slice(1).toLowerCase() : undefined;

    const updated = await this.customerRepo.update(id, {
      fullName: data.fullName,
      phone: data.phone,
      address: data.address,
      gender: normalizedGender,
      dob: data.dateOfBirth || data.dob,
      customerType: data.customerType,
      totalSpent: data.totalSpent
    });
    return this.formatCustomer(updated);
  }

  async toggleActive(id, isActive) {
    const existing = await this.customerRepo.findById(id);
    if (!existing) throw new NotFoundError('Customer');

    const updated = await this.customerRepo.toggleActive(id, isActive);
    return this.formatCustomer(updated);
  }

  async delete(id) {
    const existing = await this.customerRepo.findById(id);
    if (!existing) throw new NotFoundError('Customer');

    // Soft delete: set is_active = false
    const updated = await this.customerRepo.softDelete(id);
    return this.formatCustomer(updated);
  }
}

module.exports = CustomerService;
