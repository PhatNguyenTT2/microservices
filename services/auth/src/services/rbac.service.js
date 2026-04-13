const { ValidationError, NotFoundError, ConflictError } = require('../../../../shared/common/errors');

/**
 * Transform DB role row → monolithic-compatible format.
 * Frontend expects: { id, roleName, description, permissions: [string], employeeCount }
 */
function transformRole(row) {
  return {
    id: row.id,
    roleName: row.name,
    description: row.description,
    permissions: (row.permissions || []).map(p => p.code),
    employeeCount: row.employee_count || 0,
  };
}

class RbacService {
  constructor({ roleRepo }) {
    this.roleRepo = roleRepo;
  }

  async listRoles({ search } = {}) {
    const rows = search
      ? await this.roleRepo.search(search)
      : await this.roleRepo.findAll();

    const roles = rows.map(transformRole);
    return { roles, count: roles.length };
  }

  async getRoleById(id) {
    const role = await this.roleRepo.findById(id);
    if (!role) throw new NotFoundError('Role');
    return { role: transformRole(role) };
  }

  async createRole({ roleName, description, permissions }) {
    const name = roleName;
    if (!name) throw new ValidationError('Role name is required');

    const existing = await this.roleRepo.findByName(name);
    if (existing) throw new ConflictError('Role name already exists');

    const role = await this.roleRepo.create({ name, description });

    // Frontend sends permission codes → resolve to IDs
    if (permissions?.length > 0) {
      const permissionIds = await this.roleRepo.findPermissionIdsByCodes(permissions);
      if (permissionIds.length > 0) {
        await this.roleRepo.setPermissions(role.id, permissionIds);
      }
    }

    const full = await this.roleRepo.findById(role.id);
    return { role: transformRole(full) };
  }

  async updateRole(id, { roleName, description, permissions }) {
    const existing = await this.roleRepo.findById(id);
    if (!existing) throw new NotFoundError('Role');

    const name = roleName;
    if (name) {
      const duplicate = await this.roleRepo.findByName(name);
      if (duplicate && Number(duplicate.id) !== Number(id)) {
        throw new ConflictError('Role name already exists');
      }
    }

    await this.roleRepo.update(id, { name, description });

    // Frontend sends permission codes → resolve to IDs
    if (permissions !== undefined) {
      const permissionIds = permissions.length > 0
        ? await this.roleRepo.findPermissionIdsByCodes(permissions)
        : [];
      await this.roleRepo.setPermissions(id, permissionIds);
    }

    const full = await this.roleRepo.findById(id);
    return { role: transformRole(full) };
  }

  async deleteRole(id) {
    const existing = await this.roleRepo.findById(id);
    if (!existing) throw new NotFoundError('Role');

    if (existing.name === 'Super Admin') {
      throw new ValidationError('Cannot delete Super Admin role');
    }

    // Check if any users are assigned to this role
    if (existing.employee_count > 0) {
      throw new ValidationError(
        `Cannot delete role. ${existing.employee_count} user(s) are currently assigned to this role`
      );
    }

    await this.roleRepo.delete(id);
    return { message: 'Role deleted successfully' };
  }

  async listPermissions() {
    const rows = await this.roleRepo.getAllPermissions();
    // Frontend expects string array of permission codes
    const permissions = rows.map(r => r.code);
    return { permissions };
  }
}

module.exports = RbacService;

