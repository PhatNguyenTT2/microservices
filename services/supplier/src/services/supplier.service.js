const { ValidationError, NotFoundError } = require('../../../../shared/common/errors');

class SupplierService {
  constructor({ supplierRepo }) {
    this.supplierRepo = supplierRepo;
  }

  /**
   * Format DB row (snake_case) → frontend-friendly (camelCase)
   */
  formatSupplier(row) {
    if (!row) return null;
    return {
      id: row.id,
      companyName: row.company_name,
      phone: row.phone || '',
      address: row.address || '',
      accountNumber: row.account_number || '',
      paymentTerms: row.payment_terms || 'cod',
      creditLimit: Number(row.credit_limit) || 0,
      currentDebt: Number(row.current_debt) || 0,
      isActive: row.is_active !== false
    };
  }

  async list(query) {
    const result = await this.supplierRepo.findAll(query);
    return {
      items: result.items.map(row => this.formatSupplier(row)),
      total: result.total
    };
  }

  async getById(id) {
    const supplier = await this.supplierRepo.findById(id);
    if (!supplier) throw new NotFoundError('Supplier not found');
    return this.formatSupplier(supplier);
  }

  async create(data) {
    if (!data.company_name && !data.companyName) {
      throw new ValidationError('company_name is required');
    }

    // Support camelCase from frontend
    const companyName = data.company_name || data.companyName;

    const existing = await this.supplierRepo.findByName(companyName);
    if (existing) {
      throw new ValidationError('A supplier with this name already exists');
    }

    const repoData = {
      company_name: companyName,
      phone: data.phone,
      address: data.address,
      account_number: data.account_number || data.accountNumber,
      payment_terms: data.payment_terms || data.paymentTerms,
      credit_limit: data.credit_limit || data.creditLimit
    };

    const created = await this.supplierRepo.create(repoData);
    return this.formatSupplier(created);
  }

  async update(id, data) {
    const existing = await this.supplierRepo.findById(id);
    if (!existing) throw new NotFoundError('Supplier not found');

    const companyName = data.company_name || data.companyName;

    if (companyName && companyName !== existing.company_name) {
      const nameConflict = await this.supplierRepo.findByName(companyName);
      if (nameConflict) {
        throw new ValidationError('A supplier with this name already exists');
      }
    }

    // Protect against manual debt manipulation
    delete data.current_debt;
    delete data.currentDebt;

    // Map camelCase → snake_case for repository
    const repoData = {};
    if (companyName) repoData.company_name = companyName;
    if (data.phone !== undefined) repoData.phone = data.phone;
    if (data.address !== undefined) repoData.address = data.address;
    if (data.account_number !== undefined || data.accountNumber !== undefined) {
      repoData.account_number = data.account_number || data.accountNumber;
    }
    if (data.payment_terms !== undefined || data.paymentTerms !== undefined) {
      repoData.payment_terms = data.payment_terms || data.paymentTerms;
    }
    if (data.credit_limit !== undefined || data.creditLimit !== undefined) {
      repoData.credit_limit = data.credit_limit ?? data.creditLimit;
    }
    if (data.is_active !== undefined || data.isActive !== undefined) {
      repoData.is_active = data.is_active ?? data.isActive;
    }

    const updated = await this.supplierRepo.update(id, repoData);
    return this.formatSupplier(updated);
  }

  async delete(id) {
    const existing = await this.supplierRepo.findById(id);
    if (!existing) throw new NotFoundError('Supplier not found');

    // Soft delete
    const updated = await this.supplierRepo.update(id, { is_active: false });
    return this.formatSupplier(updated);
  }

  async getDebtInfo(id) {
    const supplier = await this.supplierRepo.findById(id);
    if (!supplier) throw new NotFoundError('Supplier not found');

    return {
      supplier_id: supplier.id,
      company_name: supplier.company_name,
      credit_limit: parseFloat(supplier.credit_limit),
      current_debt: parseFloat(supplier.current_debt),
      available_credit: Math.max(0, parseFloat(supplier.credit_limit) - parseFloat(supplier.current_debt)),
      over_limit: parseFloat(supplier.current_debt) > parseFloat(supplier.credit_limit)
    };
  }
}

module.exports = SupplierService;
