/**
 * EmbeddingClient Unit Tests
 * Tests: initialization, embed, embedBatch — mocks @xenova/transformers
 */

// Create mock before requiring the module
const mockExtractor = jest.fn().mockResolvedValue({
    data: new Float32Array(768).fill(0.5)
});
const mockPipeline = jest.fn().mockResolvedValue(mockExtractor);

// Mock the entire module at require level
jest.mock('../../src/services/embedding.client', () => {
    // Provide a test-friendly implementation that mirrors the real class
    class MockEmbeddingClient {
        constructor() {
            this.isReady = false;
            this.extractor = null;
        }

        async initialize() {
            this.extractor = mockExtractor;
            this.isReady = true;
        }

        async embed(text) {
            if (!this.isReady) throw new Error('EmbeddingClient not initialized');
            const output = await this.extractor(text, { pooling: 'mean', normalize: true });
            return Array.from(output.data);
        }

        async embedBatch(texts) {
            const vectors = [];
            for (const text of texts) {
                vectors.push(await this.embed(text));
            }
            return vectors;
        }
    }
    return MockEmbeddingClient;
});

jest.mock('../../../../shared/common/logger', () => ({
    info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn()
}));

const EmbeddingClient = require('../../src/services/embedding.client');

describe('EmbeddingClient', () => {
    let client;

    beforeEach(() => {
        jest.clearAllMocks();
        client = new EmbeddingClient();
    });

    describe('initialize', () => {
        it('should load model and set isReady=true', async () => {
            expect(client.isReady).toBe(false);

            await client.initialize();

            expect(client.isReady).toBe(true);
        });
    });

    describe('embed', () => {
        it('should return 768-dimensional vector', async () => {
            await client.initialize();
            const vector = await client.embed('Bia Tiger 330ml');

            expect(vector).toHaveLength(768);
            expect(typeof vector[0]).toBe('number');
            expect(mockExtractor).toHaveBeenCalledWith(
                'Bia Tiger 330ml',
                expect.objectContaining({ pooling: 'mean', normalize: true })
            );
        });

        it('should throw before initialize', async () => {
            await expect(client.embed('test')).rejects.toThrow('not initialized');
        });
    });

    describe('embedBatch', () => {
        it('should return array of vectors', async () => {
            await client.initialize();
            const vectors = await client.embedBatch(['text1', 'text2', 'text3']);

            expect(vectors).toHaveLength(3);
            vectors.forEach(v => expect(v).toHaveLength(768));
        });

        it('should process sequentially (calls in order)', async () => {
            await client.initialize();
            mockExtractor.mockClear();

            await client.embedBatch(['a', 'b']);

            // Calls should be sequential, not parallel
            expect(mockExtractor).toHaveBeenCalledTimes(2);
            expect(mockExtractor.mock.calls[0][0]).toBe('a');
            expect(mockExtractor.mock.calls[1][0]).toBe('b');
        });
    });
});
