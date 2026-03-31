const PaymentService = require('../../src/services/payment.service');
const { ValidationError, NotFoundError, AppError } = require('../../../../shared/common/errors');

describe('Payment Service Unit Tests', () => {
    let mockPaymentRepo;
    let mockVNPayRepo;
    let mockPool;
    let mockClient;
    let paymentService;

    beforeEach(() => {
        mockPaymentRepo = {
            create: jest.fn(),
            updateStatus: jest.fn()
        };
        mockVNPayRepo = {
            create: jest.fn(),
            findByTxnRef: jest.fn(),
            completeTransaction: jest.fn()
        };
        
        mockClient = {
            query: jest.fn().mockResolvedValue({ rows: [{ store_id: 200 }] }), // Mock store_id lookup
            release: jest.fn()
        };
        mockPool = {
            connect: jest.fn().mockResolvedValue(mockClient)
        };

        paymentService = new PaymentService(mockPaymentRepo, mockVNPayRepo, mockPool);
    });

    describe('createVNPayUrl', () => {
        const storeId = 100;
        const data = {
            amount: 500000,
            reference_type: 'SaleOrder',
            reference_id: 55,
            notes: 'Don hang test',
            created_by: 1
        };
        const ipAddr = '127.0.0.1';

        it('should create pending payment and vnpay txn log simultaneously', async () => {
             mockPaymentRepo.create.mockResolvedValue({ id: 99 });
             mockVNPayRepo.create.mockResolvedValue({ id: 88 });

             const result = await paymentService.createVNPayUrl(storeId, data, ipAddr);

             expect(result.paymentUrl).toBeDefined();
             expect(result.payment.id).toBe(99);
             
             // Check transaction zones
             expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
             expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
             expect(mockClient.release).toHaveBeenCalled();
             
             // Check creation calls
             expect(mockPaymentRepo.create).toHaveBeenCalledWith(storeId, expect.objectContaining({
                 amount: 500000,
                 method: 'vnpay',
                 reference_type: 'SaleOrder'
             }));
             expect(mockVNPayRepo.create).toHaveBeenCalledWith(expect.objectContaining({
                 payment_id: 99,
                 vnp_amount: 50000000 // Multiplied by 100 for VNPay
             }));
        });
        
        it('should rollback if vnpay hash creation fails', async () => {
             mockPaymentRepo.create.mockResolvedValue({ id: 99 });
             mockVNPayRepo.create.mockRejectedValue(new Error('Hash Failed'));

             await expect(paymentService.createVNPayUrl(storeId, data, ipAddr))
                 .rejects.toThrow(AppError);

             expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
             expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
             expect(mockClient.release).toHaveBeenCalled();
        });
    });

    describe('processVNPayIPN', () => {
        const ipnDataSuccess = {
            vnp_TxnRef: 'TXN1',
            vnp_ResponseCode: '00',  // Success
            vnp_SecureHash: '123'
        };
        
        const ipnDataFail = {
            vnp_TxnRef: 'TXN2',
            vnp_ResponseCode: '24', // Cancelled
            vnp_SecureHash: '456'
        };

        it('should process successful IPN and change payment status to completed', async () => {
            mockVNPayRepo.findByTxnRef.mockResolvedValue({
                id: 1, payment_id: 99, ipn_verified: false
            });
            mockClient.query.mockResolvedValue({ rows: [{ store_id: 200 }] }); // Get store lookup
            
            const result = await paymentService.processVNPayIPN(ipnDataSuccess);
            
            expect(result.RspCode).toBe('00');
            expect(result.Message).toBe('Confirm Success');
            
            expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
            
            expect(mockVNPayRepo.completeTransaction).toHaveBeenCalledWith(1, ipnDataSuccess, true);
            
            // Should query for storeId
            expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining('SELECT store_id FROM payment'), [99]);
            // Should update payment status to completed within transaction
            expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE payment SET status = $1'), ['completed', 99, 200]);

            expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
        });

        it('should process failed IPN and change payment status to failed', async () => {
            mockVNPayRepo.findByTxnRef.mockResolvedValue({
                id: 1, payment_id: 99, ipn_verified: false
            });
            mockClient.query.mockResolvedValue({ rows: [{ store_id: 200 }] });
            
            const result = await paymentService.processVNPayIPN(ipnDataFail);
            
            expect(result.RspCode).toBe('00'); // Note: IPN should still return 00 acknowledgement
            
            expect(mockVNPayRepo.completeTransaction).toHaveBeenCalledWith(1, ipnDataFail, false);
            expect(mockClient.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE payment SET status = $1'), ['failed', 99, 200]);
        });

        it('should return error code 02 if IPN already processed', async () => {
             mockVNPayRepo.findByTxnRef.mockResolvedValue({
                 id: 1, payment_id: 99, ipn_verified: true
             });
             
             const result = await paymentService.processVNPayIPN(ipnDataSuccess);
             
             expect(result.RspCode).toBe('02');
             expect(mockClient.query).not.toHaveBeenCalledWith('BEGIN'); // No transaction happens
        });
        
        it('should throw Error if Transaction not found', async () => {
             mockVNPayRepo.findByTxnRef.mockResolvedValue(null);
             
             await expect(paymentService.processVNPayIPN(ipnDataSuccess))
                 .rejects.toThrow(NotFoundError);
        });
    });
});
