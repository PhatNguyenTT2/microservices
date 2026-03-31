const { ValidationError, NotFoundError, ConflictError } = require('../../../../shared/common/errors');

class RbacService {
  constructor({ roleRepo }) {
    this.roleRepo = roleRepo;
  }

  async listRoles() {
    return this.roleRepo.findAll();
  }

  async getRoleById(id) {
    const role = await this.roleRepo.findById(id);
    if (!role) throw new NotFoundError('Role');
    return role;
  }

  async createRole({ name, description, permissionIds }) {
    if (!name) throw new ValidationError('Role name is required');

    const existing = await this.roleRepo.findByName(name);
    if (existing) throw new ConflictError('Role name already exists');

    const role = await this.roleRepo.create({ name, description });

    if (permissionIds?.length > 0) {
      await this.roleRepo.setPermissions(role.id, permissionIds);
    }

    return this.roleRepo.findById(role.id);
  }

  async updateRole(id, { name, description, permissionIds }) {
    const existing = await this.roleRepo.findById(id);
    if (!existing) throw new NotFoundError('Role');

    if (name) {
      const duplicate = await this.roleRepo.findByName(name);
      if (duplicate && duplicate.id !== parseInt(id)) {
        throw new ConflictError('Role name already exists');
      }
    }

    await this.roleRepo.update(id, { name, description });

    if (permissionIds !== undefined) {
      await this.roleRepo.setPermissions(id, permissionIds);
    }

    return this.roleRepo.findById(id);
  }

  async deleteRole(id) {
    const existing = await this.roleRepo.findById(id);
    if (!existing) throw new NotFoundError('Role');

    // Prevent deleting Super Admin
    if (existing.name === 'Super Admin') {
      throw new ValidationError('Cannot delete Super Admin role');
    }

    return this.roleRepo.delete(id);
  }

  async listPermissions() {
    return this.roleRepo.getAllPermissions();
  }
}

module.exports = RbacService;
