# Data Replication Pattern — Customer Cache for Order Service

> **Status**: PLANNED (for Database-per-Service migration)
> **Priority**: Medium — Required when migrating away from shared Supabase DB
> **Author**: System Architect
> **Date**: 2026-04-05

---

## Context

Currently all microservices share a single Supabase PostgreSQL database. Customer data is owned by the **Auth Service** (`customers` table), and the **Order Service** only stores `customer_id` (integer FK).

The frontend resolves customer names via **Client-Side Join** — batch-calling `GET /api/customers/:id` for each unique `customer_id` found in orders. This works well for the current shared-DB setup.

However, when the system migrates to **Database-per-Service** (each service owns its own database), the Order Service will NOT be able to rely on the frontend to call Auth Service APIs for every order list render. This causes:

1. **N+1 API calls** from frontend (one per unique customer)
2. **Tight runtime coupling** — Order page fails if Auth Service is down
3. **Performance degradation** as order volume grows

---

## Solution: Event-Driven Customer Cache (CQRS Read Model)

### Architecture

```
Auth Service                          Order Service
┌─────────────┐                       ┌─────────────────┐
│  customers  │──publish──►RabbitMQ──►│  customer_cache  │
│   (source   │  customer.created     │   (read model)   │
│   of truth) │  customer.updated     │                  │
│             │  customer.deleted     │  Used by          │
└─────────────┘                       │  formatOrder()   │
                                      └─────────────────┘
```

### Phase 1: Schema — Order Service Database

```sql
-- Migration: Add customer_cache table to Order Service DB
CREATE TABLE IF NOT EXISTS customer_cache (
  customer_id   INTEGER PRIMARY KEY,
  full_name     VARCHAR(255) NOT NULL DEFAULT 'Unknown',
  phone         VARCHAR(20) DEFAULT '',
  email         VARCHAR(255) DEFAULT '',
  customer_type VARCHAR(20) DEFAULT 'guest',
  is_active     BOOLEAN DEFAULT true,
  synced_at     TIMESTAMP DEFAULT NOW(),
  source_version INTEGER DEFAULT 0  -- optimistic concurrency
);

CREATE INDEX idx_customer_cache_name ON customer_cache(full_name);
CREATE INDEX idx_customer_cache_phone ON customer_cache(phone);
```

### Phase 2: Event Publishing — Auth Service

Add outbox events when customer data changes:

```js
// auth-service/services/customer.service.js

async createCustomer(data) {
  return await db.transaction(async (client) => {
    const customer = await this.customerRepo.create(client, data);
    
    // Publish via Transactional Outbox
    await insertOutboxEvent(client, {
      event_type: 'customer.created',
      payload: {
        customerId: customer.id,
        fullName: customer.full_name,
        phone: customer.phone,
        email: customer.email,
        customerType: customer.customer_type,
        isActive: customer.is_active
      },
      service_name: 'auth-service'
    });
    
    return customer;
  });
}

async updateCustomer(id, data) {
  return await db.transaction(async (client) => {
    const customer = await this.customerRepo.update(client, id, data);
    
    await insertOutboxEvent(client, {
      event_type: 'customer.updated',
      payload: {
        customerId: customer.id,
        fullName: customer.full_name,
        phone: customer.phone,
        email: customer.email,
        customerType: customer.customer_type,
        isActive: customer.is_active
      },
      service_name: 'auth-service'
    });
    
    return customer;
  });
}
```

### Phase 3: Event Subscription — Order Service

```js
// order-service/index.js — Add to startup subscriptions

const eventTypes = require('../../../shared/event-bus/eventTypes');

// Subscribe to customer lifecycle events
await subscribe(eventTypes.CUSTOMER_CREATED, async (event) => {
  await upsertCustomerCache(event.payload);
});

await subscribe(eventTypes.CUSTOMER_UPDATED, async (event) => {
  await upsertCustomerCache(event.payload);
});

// Helper: Upsert into customer_cache
async function upsertCustomerCache(payload) {
  const { customerId, fullName, phone, email, customerType, isActive } = payload;
  
  await db.query(`
    INSERT INTO customer_cache 
      (customer_id, full_name, phone, email, customer_type, is_active, synced_at)
    VALUES ($1, $2, $3, $4, $5, $6, NOW())
    ON CONFLICT (customer_id) DO UPDATE SET
      full_name = EXCLUDED.full_name,
      phone = EXCLUDED.phone,
      email = EXCLUDED.email,
      customer_type = EXCLUDED.customer_type,
      is_active = EXCLUDED.is_active,
      synced_at = NOW(),
      source_version = customer_cache.source_version + 1
  `, [customerId, fullName, phone, email, customerType, isActive]);
}
```

### Phase 4: Enrich `formatOrder()` with JOIN

```js
// order.service.js — Updated formatOrder with cache JOIN

async getStoreOrders(storeId, filters) {
  const query = `
    SELECT o.*, 
           c.full_name AS customer_name,
           c.phone AS customer_phone,
           c.customer_type
    FROM sale_order o
    LEFT JOIN customer_cache c ON c.customer_id = o.customer_id
    WHERE o.store_id = $1
    ORDER BY o.order_date DESC
  `;
  
  const rows = await db.query(query, [storeId]);
  return rows.map(row => ({
    ...this.formatOrder(row),
    customer: {
      id: row.customer_id,
      fullName: row.customer_name || `Customer #${row.customer_id}`,
      phone: row.customer_phone || '',
      customerType: row.customer_type || 'guest'
    }
  }));
}
```

### Phase 5: Remove Frontend Client-Side Join

Once the backend returns real customer data:

1. Remove batch-resolution logic from `Orders.jsx` (L171-228)
2. Remove `_customerName`, `_customerPhone`, `_customerType` enrichment
3. Use `order.customer.fullName` directly in `OrderList.jsx`
4. Remove `customerService` import from `Orders.jsx`

---

## Event Types to Add

```js
// shared/event-bus/eventTypes.js — Add these constants
module.exports = {
  // ... existing events
  CUSTOMER_CREATED: 'customer.created',
  CUSTOMER_UPDATED: 'customer.updated',
  CUSTOMER_DELETED: 'customer.deleted',
};
```

---

## Initial Sync Strategy

When first deploying the cache, existing customers won't have events. Run a one-time seed:

```js
// scripts/seed-customer-cache.js
async function seedCustomerCache() {
  // Fetch all customers from Auth Service API
  const response = await fetch('http://auth-service:3001/api/customers?limit=10000');
  const { data } = await response.json();
  
  for (const customer of data.customers) {
    await upsertCustomerCache({
      customerId: customer.id,
      fullName: customer.full_name || customer.fullName,
      phone: customer.phone || '',
      email: customer.email || '',
      customerType: customer.customer_type || customer.customerType || 'guest',
      isActive: customer.is_active ?? true
    });
  }
  
  console.log(`Seeded ${data.customers.length} customers into cache`);
}
```

---

## Consistency Guarantees

| Concern | Mitigation |
|---------|------------|
| **Event loss** | Transactional Outbox (already in place) ensures at-least-once delivery |
| **Stale cache** | `synced_at` timestamp for monitoring; periodic full-sync job as fallback |
| **Out-of-order events** | `source_version` with optimistic concurrency — reject older versions |
| **Cache miss** (new customer, event not yet processed) | Fallback: API call to Auth Service `GET /api/customers/:id` |
| **Auth Service downtime** | Cache serves last-known data; eventual consistency is acceptable for display names |

---

## Migration Checklist

- [ ] Add `CUSTOMER_CREATED`, `CUSTOMER_UPDATED`, `CUSTOMER_DELETED` to `eventTypes.js`
- [ ] Add Transactional Outbox publishing in Auth Service customer CRUD
- [ ] Create `customer_cache` table migration in Order Service
- [ ] Add event subscriptions in Order Service `index.js`
- [ ] Run initial seed script
- [ ] Update `formatOrder()` to JOIN customer_cache
- [ ] Update frontend to use backend-provided customer data
- [ ] Remove Client-Side Join from `Orders.jsx`
- [ ] Add monitoring for cache staleness (`synced_at` drift)
- [ ] Load test with realistic order volumes

---

## Dependencies

- Database-per-Service migration must be completed first
- RabbitMQ must be reliable (CloudAMQP or self-hosted with persistence)
- Auth Service must be updated to publish customer lifecycle events

## Estimated Effort

| Task | Effort |
|------|--------|
| Auth Service event publishing | 2-3 hours |
| Order Service cache + subscriptions | 3-4 hours |
| Initial seed script | 1 hour |
| Frontend cleanup | 1 hour |
| Testing + validation | 2-3 hours |
| **Total** | **~10-12 hours** |
