/**
 * EmbeddingClient — Local Vietnamese SBERT via @xenova/transformers
 * Model: keepitreal/vietnamese-sbert (768 dimensions)
 * Runs on CPU (ONNX Runtime) — no GPU required
 */
const { pipeline } = require('@xenova/transformers');
const logger = require('../../../../shared/common/logger');

class EmbeddingClient {
    constructor(modelName = 'Xenova/multilingual-e5-base') {
        this.modelName = modelName;
        this.extractor = null;
        this.isReady = false;
    }

    /**
     * Load model on startup (cached after first download)
     */
    async initialize() {
        const startTime = Date.now();
        logger.info({ model: this.modelName }, 'Loading embedding model...');

        this.extractor = await pipeline(
            'feature-extraction',
            this.modelName,
            { quantized: true }
        );

        this.isReady = true;
        const loadMs = Date.now() - startTime;
        logger.info({ model: this.modelName, loadMs }, 'Embedding model loaded');
    }

    /**
     * Embed single text → 768d vector
     * @param {string} text
     * @returns {number[]}
     */
    async embed(text) {
        if (!this.isReady) throw new Error('Embedding model not initialized');

        const startTime = Date.now();
        const output = await this.extractor(text, {
            pooling: 'mean',
            normalize: true
        });

        const vector = Array.from(output.data);
        const latencyMs = Date.now() - startTime;

        logger.debug({ textLength: text.length, vectorDim: vector.length, latencyMs }, 'Text embedded');
        return vector;
    }

    /**
     * Embed multiple texts sequentially (avoid OOM on CPU)
     * @param {string[]} texts
     * @returns {number[][]}
     */
    async embedBatch(texts) {
        if (!this.isReady) throw new Error('Embedding model not initialized');

        const startTime = Date.now();
        const vectors = [];

        for (const text of texts) {
            const output = await this.extractor(text, {
                pooling: 'mean',
                normalize: true
            });
            vectors.push(Array.from(output.data));
        }

        const latencyMs = Date.now() - startTime;
        logger.info({ batchSize: texts.length, latencyMs }, 'Batch embedding completed');
        return vectors;
    }
}

module.exports = EmbeddingClient;
