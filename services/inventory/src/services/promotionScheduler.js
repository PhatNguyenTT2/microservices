const cron = require('node-cron');
const axios = require('axios');
const logger = require('../../../../shared/common/logger');

/**
 * Promotion Scheduler
 * Cron-based scheduler running inside Inventory service.
 * Reads config from Settings service, executes via PromotionService.
 */
class PromotionScheduler {
    constructor({ promotionService, settingsBaseUrl }) {
        this.promotionService = promotionService;
        this.settingsBaseUrl = settingsBaseUrl || 'http://localhost:3004';
        this.job = null;
        this.currentSchedule = null;
        this.lastConfig = null;
    }

    /**
     * Fetch promotion config from Settings service
     */
    async _fetchConfig() {
        try {
            const url = `${this.settingsBaseUrl}/api/internal/sales-config`;
            const response = await axios.get(url, { timeout: 10000 });

            if (response.data?.success && response.data.data) {
                return response.data.data;
            }
            logger.warn('Unexpected response from Settings sales endpoint');
            return null;
        } catch (err) {
            logger.error({ err }, 'Failed to fetch promotion config from Settings');
            return null;
        }
    }

    /**
     * Initialize scheduler — fetch config and setup cron job
     */
    async init() {
        try {
            logger.info('Initializing Promotion Scheduler...');

            const config = await this._fetchConfig();
            if (!config) {
                logger.warn('Cannot initialize scheduler: no config available');
                return;
            }

            this.lastConfig = config;

            if (!config.auto_promotion_enabled) {
                logger.info('Auto-promotion is DISABLED in settings');
                return;
            }

            const timeStr = config.promotion_start_time || '06:00';
            const [hours, minutes] = timeStr.split(':').map(Number);

            if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
                logger.error({ timeStr }, 'Invalid promotion_start_time');
                return;
            }

            const cronSchedule = `${minutes} ${hours} * * *`;
            this.currentSchedule = cronSchedule;

            this.job = cron.schedule(cronSchedule, async () => {
                logger.info('Scheduled promotion job triggered');
                try {
                    const freshConfig = await this._fetchConfig();
                    if (freshConfig) {
                        this.lastConfig = freshConfig;
                        await this.promotionService.applyAutoPromotions(freshConfig);
                    }
                } catch (err) {
                    logger.error({ err }, 'Scheduled promotion job failed');
                }
            }, {
                scheduled: true,
                timezone: 'Asia/Ho_Chi_Minh'
            });

            logger.info({ schedule: cronSchedule, time: timeStr }, 'Promotion scheduler started');
        } catch (error) {
            logger.error({ error }, 'Failed to initialize promotion scheduler');
        }
    }

    /**
     * Stop the scheduler
     */
    stop() {
        if (this.job) {
            this.job.stop();
            this.job = null;
            logger.info('Promotion scheduler stopped');
        }
    }

    /**
     * Restart with potentially new config (triggered by SETTINGS_PROMOTION_UPDATED event)
     */
    async handleConfigUpdate(eventData) {
        logger.info('Settings promotion config updated — restarting scheduler');
        this.stop();
        // If event contains config, cache it; otherwise init() will fetch
        if (eventData) {
            this.lastConfig = eventData;
        }
        await this.init();
    }

    /**
     * Run promotion immediately (manual trigger via event)
     */
    async runNow(config) {
        const effectiveConfig = config || this.lastConfig;
        if (!effectiveConfig) {
            const fetched = await this._fetchConfig();
            if (!fetched) {
                return { success: false, message: 'No promotion config available' };
            }
            this.lastConfig = fetched;
            return this.promotionService.applyAutoPromotions(fetched);
        }
        return this.promotionService.applyAutoPromotions(effectiveConfig);
    }

    /**
     * Get scheduler status
     */
    getStatus() {
        return {
            isRunning: this.job !== null,
            currentSchedule: this.currentSchedule,
            timezone: 'Asia/Ho_Chi_Minh',
            lastConfig: this.lastConfig ? {
                autoPromotionEnabled: this.lastConfig.auto_promotion_enabled,
                promotionStartTime: this.lastConfig.promotion_start_time,
                discountPercentage: this.lastConfig.promotion_discount_percentage
            } : null
        };
    }
}

module.exports = PromotionScheduler;
