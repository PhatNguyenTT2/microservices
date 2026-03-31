const OrderService = require('../../src/services/order.service');
const { ValidationError, NotFoundError, AppError } = require('../../../../shared/common/errors');

describe('OrderService Unit Tests', () => {
  let mockOrderRepo;
  let mockDetailRepo;
  let mockPool;
  let mockClient;
  let orderService;

  const storeId = 10;
  const userId = 99;

  beforeEach(() => {
    mockOrderRepo = {
      findAll: jest.fn(),
      findById: jest.fn(),
      createOrderWithClient: jest.fn(),
      updateStatusWithClient: jest.fn()
    };

    mockDetailRepo = {
      findByOrderId: jest.fn(),
      addDetailWithClient: jest.fn()
    };

    mockClient = {
      query: jest.fn(),
      release: jest.fn()
    };

    mockPool = {
      connect: jest.fn().mockResolvedValue(mockClient)
    };

    orderService = new OrderService(mockOrderRepo, mockDetailRepo, mockPool);
  });

  describe('createDraftOrder (ZONE 1)', () => {
    const validData = {
      customer_id: 1,
      delivery_type: 'pickup',
      address: '',
      discount_percentage: 10,
      shipping_fee: 0,
      items: [
        { product_name: 'P1', batch_id: 101, quantity: 2, unit_price: 100 }
      ]
    };

    it('should create an order with details successfully', async () => {
      mockOrderRepo.createOrderWithClient.mockResolvedValue({ id: 50, store_id: 10, total_amount: 180 });
      mockDetailRepo.findByOrderId.mockResolvedValue([{ id: 1, order_id: 50 }]); // final fetch

      const result = await orderService.createDraftOrder(storeId, validData, userId);

      expect(mockPool.connect).toHaveBeenCalled();
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      
      // Check total calculation (2 * 100) * 0.9 = 180 
      expect(mockOrderRepo.createOrderWithClient).toHaveBeenCalledWith(
          mockClient, storeId, expect.objectContaining({
              total_amount: 180
          })
      );

      // Check detail insertion
      expect(mockDetailRepo.addDetailWithClient).toHaveBeenCalledWith(
          mockClient, 50, expect.objectContaining({
              product_name: 'P1',
              total_price: 200 // 2 * 100
          })
      );

      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
      
      expect(result.id).toBe(50);
      expect(result.details).toHaveLength(1);
    });

    it('should throw ValidationError if items is empty', async () => {
      await expect(orderService.createDraftOrder(storeId, { items: [] }, userId))
        .rejects.toThrow(ValidationError);
      
      expect(mockPool.connect).not.toHaveBeenCalled();
    });

    it('should rollback transaction on error', async () => {
       mockOrderRepo.createOrderWithClient.mockRejectedValue(new Error('DB Failed'));

       await expect(orderService.createDraftOrder(storeId, validData, userId))
         .rejects.toThrow(AppError);

       expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
       expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('updateOrderStatus', () => {
      it('should properly update statuses', async () => {
           mockOrderRepo.findById.mockResolvedValue({ id: 50 });
           mockOrderRepo.updateStatusWithClient.mockResolvedValue({ id: 50, status: 'shipped', payment_status: 'paid' });

           const res = await orderService.updateOrderStatus(storeId, 50, 'shipped', 'paid');
           
           expect(mockOrderRepo.updateStatusWithClient).toHaveBeenCalledWith(mockClient, storeId, 50, 'shipped', 'paid');
           expect(res.status).toBe('shipped');
      });
  });
});
