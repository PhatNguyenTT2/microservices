const supertest = require('supertest');

// Mock HF client before requiring app
jest.mock('../../src/services/hf.client', () => {
    return jest.fn().mockImplementation(() => ({
        chatCompletion: jest.fn().mockResolvedValue({
            content: 'Mocked AI response',
            model: 'mock-model',
            latencyMs: 50
        })
    }));
});

const createApp = require('../../src/app');
const ChatService = require('../../src/services/chat.service');

describe('Chat API Integration Tests', () => {
    let app;
    let mockChatRepo;

    beforeEach(() => {
        mockChatRepo = {
            createSession: jest.fn().mockResolvedValue({ id: 1, user_id: 1, user_type: 'employee', store_id: 1, is_active: true }),
            findSessionById: jest.fn().mockResolvedValue({ id: 1, user_id: 1, is_active: true }),
            findSessionsByUser: jest.fn().mockResolvedValue([{ id: 1, user_id: 1 }]),
            endSession: jest.fn().mockResolvedValue({ id: 1, is_active: false }),
            addMessage: jest.fn().mockResolvedValue({ id: 1 }),
            getMessagesBySession: jest.fn().mockResolvedValue([]),
            getRecentContext: jest.fn().mockResolvedValue([])
        };

        const mockHFClient = {
            chatCompletion: jest.fn().mockResolvedValue({
                content: 'Mocked AI response',
                model: 'mock-model',
                latencyMs: 50
            })
        };

        const chatService = new ChatService(mockChatRepo, mockHFClient);
        app = createApp({ chatService });
    });

    const authHeader = { Authorization: 'Bearer test-token' };

    describe('POST /api/chat/sessions', () => {
        it('should create a new chat session', async () => {
            const res = await supertest(app)
                .post('/api/chat/sessions')
                .set(authHeader);

            expect(res.status).toBe(201);
            expect(res.body.success).toBe(true);
            expect(res.body.data.id).toBe(1);
        });

        it('should return 401 without token', async () => {
            const res = await supertest(app)
                .post('/api/chat/sessions');

            expect(res.status).toBe(401);
        });
    });

    describe('GET /api/chat/sessions', () => {
        it('should return user sessions', async () => {
            const res = await supertest(app)
                .get('/api/chat/sessions')
                .set(authHeader);

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(Array.isArray(res.body.data)).toBe(true);
        });
    });

    describe('POST /api/chat/message', () => {
        it('should process a chat message', async () => {
            const res = await supertest(app)
                .post('/api/chat/message')
                .set(authHeader)
                .send({ session_id: 1, message: 'Xin chào!' });

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.reply).toBeDefined();
            expect(res.body.data.intent).toBeDefined();
        });

        it('should detect intent in message', async () => {
            const res = await supertest(app)
                .post('/api/chat/message')
                .set(authHeader)
                .send({ session_id: 1, message: 'Coca Cola còn hàng không?' });

            expect(res.status).toBe(200);
            expect(res.body.data.intent).toBe('CHECK_STOCK');
        });

        it('should return HELP response', async () => {
            const res = await supertest(app)
                .post('/api/chat/message')
                .set(authHeader)
                .send({ session_id: 1, message: 'Giúp tôi' });

            expect(res.status).toBe(200);
            expect(res.body.data.intent).toBe('HELP');
            expect(res.body.data.reply).toContain('POSMART Assistant');
        });
    });

    describe('GET /health', () => {
        it('should return ok', async () => {
            const res = await supertest(app).get('/health');
            expect(res.status).toBe(200);
            expect(res.body.service).toBe('chatbot-service');
        });
    });

    describe('GET /api/rag/stats', () => {
        it('should return knowledge base stats when knowledgeRepo available', async () => {
            const mockKnowledgeRepo = {
                getStats: jest.fn().mockResolvedValue({
                    total_entries: '150', in_stock_count: '120',
                    out_of_stock_count: '30', oldest_sync: '2026-04-01', latest_sync: '2026-04-08'
                })
            };

            const mockHFClient = {
                chatCompletion: jest.fn().mockResolvedValue({ content: 'test', model: 'test', latencyMs: 10 })
            };
            const ragApp = createApp({
                chatService: new ChatService(mockChatRepo, mockHFClient),
                knowledgeRepo: mockKnowledgeRepo
            });

            const res = await supertest(ragApp).get('/api/rag/stats');

            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.total_entries).toBe('150');
        });
    });
});
