const PurchaseOrderService = require('../../src/services/purchase-order.service');
const { ValidationError, NotFoundError, AppError } = require('../../../../shared/common/errors');

describe('PurchaseOrderService Unit Tests', () => {
  let mockPoRepo;
  let mockPoDetailRepo;
  let mockSupplierRepo;
  let mockPool;
  let mockClient;
  let poService;

  const storeId = 15;
  const userId = 99;

  beforeEach(() => {
    mockPoRepo = {
      findAll: jest.fn(),
      findById: jest.fn(),
      createWithClient: jest.fn(),
      updateStatusWithClient: jest.fn()
    };

    mockPoDetailRepo = {
      findByPoId: jest.fn(),
      addDetailWithClient: jest.fn()
    };
    
    mockSupplierRepo = {
       findById: jest.fn(),
       updateDebtWithClient: jest.fn()
    };

    mockClient = {
      query: jest.fn(),
      release: jest.fn()
    };

    mockPool = {
      connect: jest.fn().mockResolvedValue(mockClient)
    };

    poService = new PurchaseOrderService(mockPoRepo, mockPoDetailRepo, mockSupplierRepo, mockPool);
  });

  describe('createDraftPO (ZONE 1)', () => {
    const validData = {
      supplier_id: 1,
      shipping_fee: 10,
      discount_percentage: 0,
      notes: 'test notes',
      items: [
        { product_id: 101, product_name: 'P1', quantity: 2, cost_price: 100 }
      ]
    };

    it('should create PO header and details successfully', async () => {
      mockSupplierRepo.findById.mockResolvedValue({ id: 1 });
      mockPoRepo.createWithClient.mockResolvedValue({ id: 50, store_id: 15, total_price: 210 });
      mockPoDetailRepo.findByPoId.mockResolvedValue([{ id: 1, po_id: 50 }]); // returned array

      const result = await poService.createDraftPO(storeId, validData, userId);

      expect(mockSupplierRepo.findById).toHaveBeenCalledWith(1);
      
      expect(mockPool.connect).toHaveBeenCalled();
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      
      // Verification of calculations: (2*100) + 10 shipping = 210
      expect(mockPoRepo.createWithClient).toHaveBeenCalledWith(
          mockClient, storeId, expect.objectContaining({
              total_price: 210,
              supplier_id: 1
          })
      );

      // Verify detail insertion
      expect(mockPoDetailRepo.addDetailWithClient).toHaveBeenCalledWith(
          mockClient, 50, expect.objectContaining({
              product_id: 101,
              total_price: 200 // 2 * 100
          })
      );

      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
      
      expect(result.id).toBe(50);
      expect(result.details).toHaveLength(1);
    });

    it('should throw ValidationError if items missing', async () => {
      await expect(poService.createDraftPO(storeId, { items: [] }, userId))
        .rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError if Supplier Not Found', async () => {
      mockSupplierRepo.findById.mockResolvedValue(null);
      await expect(poService.createDraftPO(storeId, validData, userId))
        .rejects.toThrow(ValidationError);
    });

    it('should rollback if nested details failure', async () => {
       mockSupplierRepo.findById.mockResolvedValue({ id: 1 });
       mockPoRepo.createWithClient.mockResolvedValue({ id: 50 });
       mockPoDetailRepo.addDetailWithClient.mockRejectedValue(new Error('Syntax Error'));

       await expect(poService.createDraftPO(storeId, validData, userId))
         .rejects.toThrow(AppError);

       expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  describe('updateStatus', () => {
      it('should properly update statuses and supplier debt on approve', async () => {
           mockPoRepo.findById.mockResolvedValue({ id: 50, supplier_id: 2, status: 'draft' });
           mockPoRepo.updateStatusWithClient.mockResolvedValue({ id: 50, status: 'approved', payment_status: 'unpaid', total_price: 1500 });
           mockSupplierRepo.updateDebtWithClient.mockResolvedValue(true);

           const res = await poService.updateStatus(storeId, 50, 'approved', 'unpaid');
           
           expect(mockPoRepo.updateStatusWithClient).toHaveBeenCalledWith(mockClient, storeId, 50, 'approved', 'unpaid');
           
           // Verify debt update
           expect(mockSupplierRepo.updateDebtWithClient).toHaveBeenCalledWith(mockClient, 2, 1500);
           expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      });
  });
});
