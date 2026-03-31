/**
 * Cross-Service SAGA Test — POS Checkout Flow
 * 
 * Tests the event handler callbacks that run when payment.completed fires.
 * Simulates the choreography: Payment → Order (completed/paid) + Inventory (deductStock)
 * 
 * NOTE: This does NOT require RabbitMQ running. It tests the handler logic directly.
 */

const OrderService = require('../../services/order/src/services/order.service');
const InventoryService = require('../../services/inventory/src/services/inventory.service');
const { ValidationError, NotFoundError } = require('../../shared/common/errors');

describe('POS Checkout SAGA — Cross-Service Integration', () => {
    let orderService;
    let inventoryService;
    let mockOrderRepo, mockDetailRepo, mockOrderPool, mockOrderClient;
    let mockInventoryRepo, mockBatchRepo, mockWarehouseRepo, mockInvPool, mockInvClient;

    beforeEach(() => {
        // ---- Order Service mocks ----
        mockOrderRepo = {
            findById: jest.fn(),
            updateStatusWithClient: jest.fn()
        };
        mockDetailRepo = {};
        mockOrderClient = { query: jest.fn(), release: jest.fn() };
        mockOrderPool = { connect: jest.fn().mockResolvedValue(mockOrderClient) };
        orderService = new OrderService(mockOrderRepo, mockDetailRepo, mockOrderPool);

        // ---- Inventory Service mocks ----
        mockInventoryRepo = {
            findItemForUpdateWithClient: jest.fn(),
            updateItemQuantitiesWithClient: jest.fn(),
            recordMovementWithClient: jest.fn()
        };
        mockBatchRepo = { findById: jest.fn() };
        mockWarehouseRepo = {};
        mockInvClient = { query: jest.fn(), release: jest.fn() };
        mockInvPool = { connect: jest.fn().mockResolvedValue(mockInvClient) };
        inventoryService = new InventoryService(mockInventoryRepo, mockBatchRepo, mockWarehouseRepo, mockInvPool);
    });

    describe('Step 1: payment.completed → Order updates to completed/paid', () => {
        it('should update order status from draft to completed with payment_status=paid', async () => {
            const eventData = {
                orderId: 50,
                storeId: 100,
                amount: 500000,
                method: 'cash'
            };

            mockOrderRepo.findById.mockResolvedValue({ id: 50, status: 'draft', payment_status: 'pending' });
            mockOrderRepo.updateStatusWithClient.mockResolvedValue({ 
                id: 50, status: 'completed', payment_status: 'paid' 
            });

            // Simulate event handler callback
            const result = await orderService.updateOrderStatus(
                eventData.storeId, eventData.orderId, 'completed', 'paid'
            );

            expect(result.status).toBe('completed');
            expect(result.payment_status).toBe('paid');
            expect(mockOrderRepo.findById).toHaveBeenCalledWith(100, 50);
            expect(mockOrderRepo.updateStatusWithClient).toHaveBeenCalledWith(
                mockOrderClient, 100, 50, 'completed', 'paid'
            );
        });

        it('should throw AppError (wrapping NotFoundError) if order does not exist', async () => {
            mockOrderRepo.findById.mockResolvedValue(null);

            await expect(
                orderService.updateOrderStatus(100, 999, 'completed', 'paid')
            ).rejects.toThrow('Update status failed');
        });
    });

    describe('Step 2: payment.completed → Inventory deducts stock', () => {
        it('should deduct on_shelf quantity for each item in the order', async () => {
            const eventData = {
                orderId: 50,
                storeId: 100,
                items: [
                    { batchId: 1, locationId: 10, quantity: 3 },
                    { batchId: 2, locationId: 10, quantity: 1 }
                ]
            };

            // Setup mocks for both items
            mockBatchRepo.findById.mockResolvedValue({ id: 1, status: 'active' });
            mockInventoryRepo.findItemForUpdateWithClient.mockResolvedValue({ 
                id: 888, quantity_on_shelf: 50 
            });

            // Simulate event handler: iterate items and deductStock
            for (const item of eventData.items) {
                await inventoryService.deductStock(
                    eventData.storeId,
                    item.batchId,
                    item.locationId,
                    item.quantity,
                    null,
                    `pos_sale_order_${eventData.orderId}`
                );
            }

            // Should have been called twice (2 items)
            expect(mockBatchRepo.findById).toHaveBeenCalledTimes(2);
            expect(mockInventoryRepo.updateItemQuantitiesWithClient).toHaveBeenCalledTimes(2);
            expect(mockInventoryRepo.recordMovementWithClient).toHaveBeenCalledTimes(2);

            // Verify movement reason includes order ID
            expect(mockInventoryRepo.recordMovementWithClient).toHaveBeenCalledWith(
                mockInvClient,
                expect.objectContaining({
                    movement_type: 'out',
                    reason: 'pos_sale_order_50'
                })
            );
        });

        it('should handle partial failure — one item insufficient stock', async () => {
            const eventData = {
                orderId: 50,
                storeId: 100,
                items: [
                    { batchId: 1, locationId: 10, quantity: 3 },
                    { batchId: 2, locationId: 10, quantity: 100 } // Too much
                ]
            };

            mockBatchRepo.findById.mockResolvedValue({ id: 1, status: 'active' });

            // First item: enough stock
            mockInventoryRepo.findItemForUpdateWithClient
                .mockResolvedValueOnce({ id: 888, quantity_on_shelf: 50 });
            // Second item: not enough stock
            mockInventoryRepo.findItemForUpdateWithClient
                .mockResolvedValueOnce({ id: 889, quantity_on_shelf: 5 });

            // First item succeeds
            await inventoryService.deductStock(eventData.storeId, 1, 10, 3, null);

            // Second item fails
            await expect(
                inventoryService.deductStock(eventData.storeId, 2, 10, 100, null)
            ).rejects.toThrow(ValidationError);
        });
    });

    describe('Full SAGA Flow — Happy Path', () => {
        it('should complete the entire POS checkout saga', async () => {
            const paymentEvent = {
                data: {
                    paymentId: 1,
                    orderId: 50,
                    storeId: 100,
                    referenceType: 'sale_order',
                    amount: 500000,
                    method: 'cash',
                    items: [
                        { batchId: 1, locationId: 10, quantity: 2 }
                    ]
                }
            };

            // --- Order handler ---
            mockOrderRepo.findById.mockResolvedValue({ id: 50, status: 'draft' });
            mockOrderRepo.updateStatusWithClient.mockResolvedValue({ 
                id: 50, status: 'completed', payment_status: 'paid' 
            });

            const orderResult = await orderService.updateOrderStatus(
                paymentEvent.data.storeId,
                paymentEvent.data.orderId,
                'completed',
                'paid'
            );

            expect(orderResult.status).toBe('completed');

            // --- Inventory handler ---
            mockBatchRepo.findById.mockResolvedValue({ id: 1, status: 'active' });
            mockInventoryRepo.findItemForUpdateWithClient.mockResolvedValue({ 
                id: 888, quantity_on_shelf: 100 
            });

            for (const item of paymentEvent.data.items) {
                const invResult = await inventoryService.deductStock(
                    paymentEvent.data.storeId,
                    item.batchId,
                    item.locationId,
                    item.quantity,
                    null,
                    `pos_sale_order_${paymentEvent.data.orderId}`
                );
                expect(invResult.message).toBe('Stock deducted successfully');
            }

            // Verify movement log has correct data
            expect(mockInventoryRepo.recordMovementWithClient).toHaveBeenCalledWith(
                mockInvClient,
                expect.objectContaining({
                    movement_type: 'out',
                    quantity: 2,
                    reason: 'pos_sale_order_50'
                })
            );
        });
    });
});
