const bcrypt = require('bcrypt');
const { ValidationError, NotFoundError, ConflictError } = require('../../../../shared/common/errors');

/**
 * Transform flat DB row → monolithic-compatible POS access format.
 * Frontend expects nested employee object with userAccount.
 */
function transformPosAccess(row) {
  const now = new Date();
  const lockedUntil = row.locked_until ? new Date(row.locked_until) : null;
  const isPinLocked = lockedUntil && lockedUntil > now;
  const minutesUntilUnlock = isPinLocked
    ? Math.ceil((lockedUntil - now) / 60000)
    : 0;

  return {
    id: row.user_id,
    employee: {
      id: row.user_id,
      fullName: row.full_name,
      phone: row.phone || null,
      storeId: row.store_id || null,
      storeName: row.store_name || null,
      userAccount: {
        id: row.user_id,
        username: row.username,
        email: row.email,
        userCode: `USR${String(row.user_id).padStart(3, '0')}`,
        isActive: row.is_active,
        role: {
          id: row.role_id,
          roleName: row.role_name
        }
      }
    },
    canAccessPOS: row.is_enabled,
    pinFailedAttempts: row.failed_attempts || 0,
    pinLockedUntil: row.locked_until || null,
    posLastLogin: row.pos_last_login || null,
    isPinLocked,
    minutesUntilUnlock
  };
}

/**
 * Transform available employee row → frontend format for grant modal.
 */
function transformAvailableEmployee(row) {
  return {
    id: row.id,
    fullName: row.full_name,
    phone: row.phone || null,
    storeId: row.store_id || null,
    storeName: row.store_name || null,
    userAccount: {
      id: row.id,
      username: row.username,
      email: row.email,
      userCode: `USR${String(row.id).padStart(3, '0')}`,
      isActive: row.is_active,
      role: {
        id: row.role_id,
        roleName: row.role_name
      }
    }
  };
}

class PosAuthService {
  constructor({ authRepo, employeeRepo, userRepo }) {
    this.authRepo = authRepo;
    this.employeeRepo = employeeRepo;
    this.userRepo = userRepo;
  }

  async list() {
    const rows = await this.authRepo.findAllPosAuth();
    return rows.map(transformPosAccess);
  }

  async getById(userId) {
    const row = await this.authRepo.findPosAuthWithDetails(userId);
    if (!row) throw new NotFoundError('POS auth record not found');
    return transformPosAccess(row);
  }

  async getAvailableEmployees() {
    const rows = await this.authRepo.findAvailableEmployees();
    return rows.map(transformAvailableEmployee);
  }

  async grant(userId, pin) {
    if (!userId || !pin) {
      throw new ValidationError('Employee ID and PIN are required');
    }
    if (pin.length < 4 || pin.length > 8) {
      throw new ValidationError('PIN must be 4-8 digits');
    }

    const existing = await this.authRepo.findPosAuth(userId);
    if (existing) {
      throw new ConflictError('Employee already has POS access');
    }

    const employee = await this.employeeRepo.findById(userId);
    if (!employee) throw new NotFoundError('Employee not found');

    // Check if employee's role has pos_access permission
    const permissions = await this.userRepo.getPermissions(userId);
    if (!permissions.includes('pos_access')) {
      throw new ValidationError(
        `Role "${employee.role_name}" does not have POS access permission. ` +
        'Please assign a role with pos_access permission first.'
      );
    }

    const pinHash = await bcrypt.hash(pin, 10);
    await this.authRepo.upsertPosAuth({ userId, pinHash });

    const created = await this.authRepo.findPosAuthWithDetails(userId);
    return transformPosAccess(created);
  }

  async updatePin(userId, pin) {
    if (!pin) throw new ValidationError('PIN is required');
    if (pin.length < 4 || pin.length > 8) {
      throw new ValidationError('PIN must be 4-8 digits');
    }

    const existing = await this.authRepo.findPosAuth(userId);
    if (!existing) throw new NotFoundError('POS auth record not found');

    const pinHash = await bcrypt.hash(pin, 10);
    await this.authRepo.upsertPosAuth({ userId, pinHash });

    return { message: 'PIN updated successfully' };
  }

  async enable(userId) {
    const existing = await this.authRepo.findPosAuth(userId);
    if (!existing) throw new NotFoundError('POS auth record not found');

    await this.authRepo.enablePosAuth(userId);
    return { message: 'POS access enabled' };
  }

  async disable(userId) {
    const existing = await this.authRepo.findPosAuth(userId);
    if (!existing) throw new NotFoundError('POS auth record not found');

    await this.authRepo.disablePosAuth(userId);
    return { message: 'POS access disabled' };
  }

  async resetAttempts(userId) {
    const existing = await this.authRepo.findPosAuth(userId);
    if (!existing) throw new NotFoundError('POS auth record not found');

    await this.authRepo.resetPosFailedAttempts(userId);
    return { message: 'Failed attempts reset and account unlocked' };
  }

  async revoke(userId) {
    const existing = await this.authRepo.findPosAuth(userId);
    if (!existing) throw new NotFoundError('POS auth record not found');

    await this.authRepo.deletePosAuth(userId);
    return { message: 'POS access revoked' };
  }
}

module.exports = PosAuthService;
