const request = require('supertest');
const createApp = require('../../src/app');

// Mock dependencies
jest.mock('../../../../shared/auth-middleware', () => require('../__mocks__/auth-middleware'));

describe('Payment API Integration', () => {
    let app, mockPaymentService;

    beforeEach(() => {
        mockPaymentService = {
            getPayments: jest.fn(),
            createDirectPayment: jest.fn(),
            createVNPayUrl: jest.fn(),
            processVNPayIPN: jest.fn()
        };

        app = createApp({ paymentService: mockPaymentService });
    });

    // === Payments ===
    describe('GET /api/payments', () => {
        it('should return payments', async () => {
            mockPaymentService.getPayments.mockResolvedValue([{ id: 1, amount: 10000 }]);
            const res = await request(app).get('/api/payments').set('Authorization', 'Bearer token');
            expect(res.status).toBe(200);
            expect(res.body.data.payments).toHaveLength(1);
        });
    });

    describe('POST /api/payments/direct', () => {
        it('should create direct payment', async () => {
            mockPaymentService.createDirectPayment.mockResolvedValue({ id: 1, status: 'completed' });
            const res = await request(app).post('/api/payments/direct')
                .set('Authorization', 'Bearer token')
                .send({ reference_id: 1, reference_type: 'order', amount: 50000, method: 'cash' });
            expect(res.status).toBe(201);
            expect(res.body.data.payment.status).toBe('completed');
        });
    });

    // === VNPay ===
    describe('POST /api/payments/vnpay/create-url', () => {
        it('should create VNPay URL', async () => {
            mockPaymentService.createVNPayUrl.mockResolvedValue({ payment_url: 'https://vnpay.vn/pay?...' });
            const res = await request(app).post('/api/payments/vnpay/create-url')
                .set('Authorization', 'Bearer token')
                .send({ reference_id: 1, reference_type: 'order', amount: 100000, bank_code: 'VNPAYQR' });
            expect(res.status).toBe(201);
            expect(res.body.data.payment_url).toContain('https://vnpay');
        });
    });

    describe('GET /api/payments/vnpay/ipn', () => {
        it('should process IPN and return 200 with RspCode', async () => {
            mockPaymentService.processVNPayIPN.mockResolvedValue({ RspCode: '00', Message: 'Success' });
            const res = await request(app).get('/api/payments/vnpay/ipn?vnp_Amount=100000');
            // IPN endpoint does NOT use auth token typically, it is public
            expect(res.status).toBe(200);
            expect(res.body.RspCode).toBe('00');
        });

        it('should return 200 and RspCode 99 on error', async () => {
            mockPaymentService.processVNPayIPN.mockRejectedValue(new Error('Invalid signature'));
            const res = await request(app).get('/api/payments/vnpay/ipn?vnp_Amount=100000');
            // Even on error VNPay requires 200 OK
            expect(res.status).toBe(200);
            expect(res.body.RspCode).toBe('99');
        });
    });
});
