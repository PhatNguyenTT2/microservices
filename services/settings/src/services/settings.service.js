const { ValidationError } = require('../../../../shared/common/errors');

class SettingsService {
  constructor({ securitySettingsRepo, salesSettingsRepo, historyRepo, pool }) {
    this.securityRepo = securitySettingsRepo;
    this.salesRepo = salesSettingsRepo;
    this.historyRepo = historyRepo;
    this.pool = pool;
  }

  async getSecuritySettings() {
    return this.securityRepo.get();
  }

  async getSalesSettings() {
    return this.salesRepo.get();
  }

  /**
   * Get customer discount rates from sales_settings
   * Returns { retail, wholesale, vip } format matching frontend expectations
   */
  async getCustomerDiscounts() {
    const sales = await this.salesRepo.get();
    return {
      retail: parseFloat(sales.discount_retail || 0),
      wholesale: parseFloat(sales.discount_wholesale || 5),
      vip: parseFloat(sales.discount_vip || 10)
    };
  }

  async getHistory(query) {
    return this.historyRepo.findAll(query);
  }

  /**
   * Transaction Zone 1: Update Security Settings & Log History atomically
   */
  async updateSecuritySettings(data, userId, reason) {
    if (!reason) throw new ValidationError('Change reason is required for audit trails');
    const allowed = ['max_failed_attempts', 'lock_duration_minutes'];
    const hasChanges = Object.keys(data).some(k => allowed.includes(k));
    if (!hasChanges) throw new ValidationError('No valid settings fields provided');

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      
      const oldValue = await this.securityRepo.get();
      const updatedData = { ...data, updated_by: userId };
      
      const newValue = await this.securityRepo.updateWithClient(client, updatedData);
      
      await this.historyRepo.createWithClient(client, {
        setting_type: 'security', old_value: oldValue, new_value: newValue,
        changed_by: userId, change_reason: reason
      });

      await client.query('COMMIT');
      return newValue;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Transaction Zone 1: Update Sales Settings & Log History atomically
   */
  async updateSalesSettings(data, userId, reason) {
    if (!reason) throw new ValidationError('Change reason is required for audit trails');
    const allowed = [
      'auto_promotion_enabled', 'promotion_start_time', 'promotion_discount_percentage',
      'discount_retail', 'discount_wholesale', 'discount_vip',
      'apply_to_expiring_today', 'apply_to_expiring_tomorrow'
    ];
    const hasChanges = Object.keys(data).some(k => allowed.includes(k));
    if (!hasChanges) throw new ValidationError('No valid settings fields provided');

    const promotionFields = ['auto_promotion_enabled', 'promotion_start_time', 'promotion_discount_percentage', 'apply_to_expiring_today', 'apply_to_expiring_tomorrow'];
    const promotionChanged = Object.keys(data).some(k => promotionFields.includes(k));

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      
      const oldValue = await this.salesRepo.get();
      const updatedData = { ...data, updated_by: userId };
      
      const newValue = await this.salesRepo.updateWithClient(client, updatedData);
      
      await this.historyRepo.createWithClient(client, {
        setting_type: 'sales', old_value: oldValue, new_value: newValue,
        changed_by: userId, change_reason: reason
      });

      await client.query('COMMIT');

      // Notify Inventory scheduler if promotion config changed
      if (promotionChanged) {
        try {
          const eventBus = require('../../../../shared/event-bus');
          const EVENT = require('../../../../shared/event-bus/eventTypes');
          await eventBus.publish(EVENT.SETTINGS_PROMOTION_UPDATED, newValue);
        } catch (pubErr) {
          // Non-critical — scheduler will pick up on next restart
          console.error('Failed to publish promotion update event:', pubErr.message);
        }
      }

      return newValue;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Get settings change history with pagination and optional type filter
   */
  async getHistory({ settingType, page, limit } = {}) {
    return this.historyRepo.findAll({
      settingType,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20
    });
  }
}

module.exports = SettingsService;
