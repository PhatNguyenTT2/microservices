/**
 * Domain Event Types — All events in the POSMART system.
 * Use as constants to avoid typos in event routing.
 *
 * Updated: 2026-04-03 — Aligned with current Saga Choreography
 */
module.exports = {
  // Auth & Customer Service
  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  EMPLOYEE_CREATED: 'employee.created',
  EMPLOYEE_UPDATED: 'employee.updated',
  CUSTOMER_CREATED: 'customer.created',
  CUSTOMER_UPDATED: 'customer.updated',

  // Product & Inventory Service
  PRODUCT_CREATED: 'product.created',
  PRODUCT_UPDATED: 'product.updated',
  PRODUCT_DELETED: 'product.deleted',
  PRODUCT_PRICE_CHANGED: 'product.price_changed',
  BATCH_CREATED: 'batch.created',
  BATCH_EXPIRED: 'batch.expired',
  INVENTORY_UPDATED: 'inventory.updated',
  INVENTORY_LOW_STOCK: 'inventory.low_stock',

  // Order Service (Producer)
  ORDER_COMPLETED: 'order.completed',
  ORDER_SHIPPING: 'order.shipping',
  ORDER_DELIVERED: 'order.delivered',
  ORDER_CANCELLED: 'order.cancelled',
  ORDER_REFUNDED: 'order.refunded',

  // Payment Service (Producer)
  PAYMENT_COMPLETED: 'payment.completed',
  PAYMENT_FAILED: 'payment.failed',
  PAYMENT_TIMEOUT: 'payment.timeout',
  PAYMENT_REFUNDED: 'payment.refunded',

  // Saga Compensation
  INVENTORY_DEDUCT_FAILED: 'inventory.deduct_failed',

  // Settings Service
  SETTINGS_POS_SECURITY_UPDATED: 'settings.pos_security_updated',
  SETTINGS_PROMOTION_UPDATED: 'settings.promotion_updated',
  SETTINGS_DISCOUNT_UPDATED: 'settings.discount_updated',

  // Fresh Product Promotion (cross-service: Settings ↔ Inventory)
  PROMOTION_RUN_REQUESTED: 'promotion.run_requested',
  PROMOTION_APPLIED: 'promotion.applied',

  // Supplier Service
  PO_CREATED: 'purchaseorder.created',
  PO_APPROVED: 'purchaseorder.approved',
  PO_RECEIVED: 'purchaseorder.received',
  PO_CANCELLED: 'purchaseorder.cancelled',
  SUPPLIER_DEBT_UPDATED: 'supplier.debt_updated'
};
