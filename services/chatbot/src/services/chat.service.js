const { ValidationError, NotFoundError } = require('../../../../shared/common/errors');
const { resolveIntent } = require('./intent.resolver');
const { getPersonalizationContext, getCoPurchaseHint } = require('./context.helper');
const logger = require('../../../../shared/common/logger');

class ChatService {
    constructor(chatRepo, hfClient, apiClient = null, ragService = null, copurchaseRepo = null) {
        this.chatRepo = chatRepo;
        this.hfClient = hfClient;
        this.apiClient = apiClient;
        this.ragService = ragService;
        this.copurchaseRepo = copurchaseRepo;
    }

    async startSession(userId, userType, storeId = null) {
        if (!userId) throw new ValidationError('user_id is required');
        if (!['customer', 'employee'].includes(userType)) {
            throw new ValidationError('user_type must be customer or employee');
        }
        return await this.chatRepo.createSession(userId, userType, storeId);
    }

    async getSession(sessionId) {
        const session = await this.chatRepo.findSessionById(sessionId);
        if (!session) throw new NotFoundError('Chat session');
        return session;
    }

    async getUserSessions(userId) {
        return await this.chatRepo.findSessionsByUser(userId);
    }

    async getSessionMessages(sessionId) {
        const session = await this.chatRepo.findSessionById(sessionId);
        if (!session) throw new NotFoundError('Chat session');
        return await this.chatRepo.getMessagesBySession(sessionId);
    }

    async endSession(sessionId) {
        const session = await this.chatRepo.findSessionById(sessionId);
        if (!session) throw new NotFoundError('Chat session');
        return await this.chatRepo.endSession(sessionId);
    }

    async sendMessage(sessionId, userMessage) {
        if (!userMessage || userMessage.trim().length === 0) {
            throw new ValidationError('Message cannot be empty');
        }

        const session = await this.chatRepo.findSessionById(sessionId);
        if (!session) throw new NotFoundError('Chat session');
        if (!session.is_active) throw new ValidationError('Chat session has ended');

        const intentResult = resolveIntent(userMessage);
        logger.info({ sessionId, intent: intentResult.intent, keyword: intentResult.matchedKeyword }, 'Intent resolved');

        await this.chatRepo.addMessage(sessionId, 'user', userMessage, intentResult.intent);

        let response;
        switch (intentResult.intent) {
            case 'CHECK_STOCK':
                response = await this._handleCheckStock(session, userMessage);
                break;
            case 'CHECK_PRICE':
                response = await this._handleCheckPrice(session, userMessage);
                break;
            case 'ORDER_STATUS':
                response = await this._handleOrderStatus(session, userMessage);
                break;
            case 'RECOMMENDATION':
                response = await this._handleRecommendation(session, userMessage);
                break;
            case 'SEARCH_PRODUCT':
                response = await this._handleSearchProduct(session, userMessage);
                break;
            case 'HELP':
                response = this._handleHelp();
                break;
            case 'FREE_CHAT':
            default:
                response = await this._handleFreeChat(sessionId, userMessage);
                break;
        }

        await this.chatRepo.addMessage(sessionId, 'assistant', response.content, intentResult.intent, {
            model: response.model || null,
            latencyMs: response.latencyMs || null,
            intent: intentResult.intent,
            apiCalled: response.apiCalled || null,
            error: response.error || null
        });

        return {
            intent: intentResult.intent,
            reply: response.content,
            products: response.products || null,
            metadata: {
                model: response.model,
                latencyMs: response.latencyMs,
                intent: intentResult,
                apiCalled: response.apiCalled || null,
                ragMetadata: response.ragMetadata || null
            }
        };
    }

    // ── RAG Intent Handlers ──────────────────────

    async _handleRecommendation(session, userMessage) {
        if (!this.ragService) {
            return this._handleSearchProductFallback(session.id, userMessage);
        }

        const storeId = session.store_id || 1;
        const customerId = session.user_type === 'customer' ? session.user_id : null;
        const chatHistory = await this._getRecentHistory(session.id);

        const result = await this.ragService.recommend(
            userMessage, storeId, customerId, chatHistory
        );

        return {
            content: result.content,
            products: result.products,
            ragMetadata: result.metadata
        };
    }

    // ── Data Intent Handlers ─────────────────────

    async _handleCheckStock(session, userMessage) {
        const sessionId = session.id;
        const storeId = session.store_id || 1;
        const isCustomer = session.user_type === 'customer';
        const keyword = this._extractKeyword(userMessage, ['tồn kho', 'còn hàng', 'còn không', 'hết hàng', 'có còn', 'stock']);

        if (!this.apiClient) return this._fallbackNoApi('CHECK_STOCK', keyword);

        const resolved = await this._resolveProductsByRAG(keyword, storeId, 1);
        if (!resolved.products.length) {
            return this._enrichWithAI(sessionId, userMessage,
                `[DATA] Không tìm thấy sản phẩm "${keyword}" trong hệ thống.`,
                { userType: session.user_type });
        }

        const product = resolved.products[0];
        const stockResult = await this.apiClient.getInventorySummary(storeId, product.id);
        const items = Array.isArray(stockResult.data) ? stockResult.data : [];
        const stock = items.find(i => String(i.productId || i.id) === String(product.id));

        let stockInfo;
        if (stock) {
            if (isCustomer) {
                // Customer: simplified — only onShelf matters
                const onShelf = stock.quantityOnShelf || 0;
                stockInfo = onShelf > 0
                    ? `Sản phẩm "${product.name}": Đang có ${onShelf} sản phẩm trên kệ.`
                    : `Sản phẩm "${product.name}": Hiện tạm hết hàng trên kệ.`;
            } else {
                // Employee: full internal data
                stockInfo = `Sản phẩm "${product.name}" (ID: ${product.id}): ` +
                    `On-hand: ${stock.quantityOnHand || 0}, On-shelf: ${stock.quantityOnShelf || 0}, ` +
                    `Reserved: ${stock.quantityReserved || 0}, Available: ${stock.quantityAvailable || 0}`;
            }
        } else {
            stockInfo = `Sản phẩm "${product.name}": Chưa có dữ liệu tồn kho.`;
        }

        // Customer enrichments
        let customerContext = null, coPurchaseHint = '';
        if (isCustomer) {
            const customerId = session.user_id;
            [customerContext, coPurchaseHint] = await Promise.all([
                getPersonalizationContext(this.apiClient, customerId),
                getCoPurchaseHint(this.copurchaseRepo, [product.id], storeId)
            ]);
        }

        const aiResponse = await this._enrichWithAI(sessionId, userMessage,
            `[DATA] ${stockInfo}`, {
                apiCalled: 'inventory:summary',
                userType: session.user_type,
                customerContext,
                coPurchaseHint
            });

        return {
            ...aiResponse,
            products: isCustomer ? [{
                id: product.id, name: product.name,
                unitPrice: product.unitPrice, image: product.image,
                quantityOnShelf: stock?.quantityOnShelf || 0
            }] : null
        };
    }

    async _handleCheckPrice(session, userMessage) {
        const sessionId = session.id;
        const storeId = session.store_id || 1;
        const isCustomer = session.user_type === 'customer';
        const keyword = this._extractKeyword(userMessage, ['giá', 'bao nhiêu', 'price', 'giá bán', 'giá tiền']);

        if (!this.apiClient) return this._fallbackNoApi('CHECK_PRICE', keyword);

        const resolved = await this._resolveProductsByRAG(keyword, storeId, 5);
        if (!resolved.products.length) {
            return this._enrichWithAI(sessionId, userMessage,
                `[DATA] Không tìm thấy sản phẩm "${keyword}" trong hệ thống.`,
                { userType: session.user_type });
        }

        const products = resolved.products;

        // Employee: raw price list
        // Customer: price + stock availability (onShelf)
        let priceList;
        let enrichedProducts = products;

        if (isCustomer) {
            // O2O: fetch stock for each product
            enrichedProducts = await Promise.all(products.map(async p => {
                try {
                    const stock = await this.apiClient.getInventorySummary(storeId, p.id);
                    const item = stock.data?.[0];
                    return { ...p, quantityOnShelf: item?.quantityOnShelf || 0 };
                } catch {
                    return { ...p, quantityOnShelf: 0 };
                }
            }));

            priceList = enrichedProducts.map(p => {
                const status = p.quantityOnShelf > 0 ? `còn ${p.quantityOnShelf} trên kệ` : 'tạm hết hàng';
                return `- ${p.name}: ${Number(p.unitPrice || 0).toLocaleString('vi-VN')}đ (${status})`;
            }).join('\n');
        } else {
            priceList = products.map(p =>
                `- ${p.name} (ID: ${p.id}): ${Number(p.unitPrice || 0).toLocaleString('vi-VN')}đ`
            ).join('\n');
        }

        // Customer enrichments
        let customerContext = null, coPurchaseHint = '';
        if (isCustomer) {
            const customerId = session.user_id;
            const productIds = products.map(p => p.id);
            [customerContext, coPurchaseHint] = await Promise.all([
                getPersonalizationContext(this.apiClient, customerId),
                getCoPurchaseHint(this.copurchaseRepo, productIds, storeId)
            ]);
        }

        const aiResponse = await this._enrichWithAI(sessionId, userMessage,
            `[DATA] Kết quả tìm kiếm giá:\n${priceList}`, {
                apiCalled: 'catalog:products',
                userType: session.user_type,
                customerContext,
                coPurchaseHint
            });

        return {
            ...aiResponse,
            products: isCustomer ? enrichedProducts.map(p => ({
                id: p.id, name: p.name, unitPrice: p.unitPrice,
                image: p.image, quantityOnShelf: p.quantityOnShelf || 0
            })) : null
        };
    }

    async _handleOrderStatus(session, userMessage) {
        const sessionId = session.id;
        const isCustomer = session.user_type === 'customer';
        const orderId = this._extractOrderId(userMessage);

        if (!this.apiClient) return this._fallbackNoApi('ORDER_STATUS', orderId);

        // Vietnamese status labels
        const statusLabels = {
            draft: 'Nháp', shipping: 'Đang giao', delivered: 'Đã giao',
            cancelled: 'Đã hủy', refunded: 'Đã hoàn tiền', completed: 'Hoàn thành'
        };
        const paymentLabels = {
            pending: 'Chờ thanh toán', partial: 'Thanh toán một phần', paid: 'Đã thanh toán',
            failed: 'Thanh toán thất bại', refunded: 'Đã hoàn tiền', partial_refund: 'Hoàn tiền một phần'
        };

        if (orderId) {
            const result = await this.apiClient.getOrderById(orderId);
            if (result.success && result.data?.order) {
                const o = result.data.order;
                const statusVi = statusLabels[o.status] || o.status;
                const paymentVi = paymentLabels[o.paymentStatus] || o.paymentStatus;

                let info;
                if (isCustomer) {
                    info = `Đơn hàng ${o.orderNumber}:\n` +
                        `- Trạng thái: ${statusVi}\n` +
                        `- Thanh toán: ${paymentVi}\n` +
                        `- Tổng tiền: ${Number(o.total || 0).toLocaleString('vi-VN')}đ`;

                    // Add delivery info if shipping
                    if (o.deliveryType === 'delivery') {
                        info += `\n- Giao hàng: ${o.address || 'Chưa có địa chỉ'}`;
                    }
                } else {
                    // Employee: full raw data + IDs
                    info = `Đơn hàng ${o.orderNumber} (ID: ${o.id}):\n` +
                        `- Trạng thái: ${statusVi} (${o.status})\n` +
                        `- Thanh toán: ${paymentVi} (${o.paymentStatus})\n` +
                        `- Loại: ${o.deliveryType === 'delivery' ? 'Giao hàng' : 'Nhận tại cửa hàng'}\n` +
                        `- Tổng tiền: ${Number(o.total || 0).toLocaleString('vi-VN')}đ` +
                        (o.shippingFee > 0 ? ` (Phí ship: ${Number(o.shippingFee).toLocaleString('vi-VN')}đ)` : '') +
                        (o.discountPercentage > 0 ? ` (Giảm: ${o.discountPercentage}%)` : '') +
                        `\n- KH: #${o.customerId} | NV: #${o.createdBy} | Ngày: ${new Date(o.orderDate).toLocaleDateString('vi-VN')}`;
                }

                // Add order detail items if available
                if (o.details?.length) {
                    const detailLines = o.details.map((d, i) =>
                        `  ${i + 1}. ${d.productName} x${d.quantity} — ${Number(d.totalPrice || 0).toLocaleString('vi-VN')}đ`
                    ).join('\n');
                    info += `\nChi tiết đơn hàng:\n${detailLines}`;
                }

                return this._enrichWithAI(sessionId, userMessage, `[DATA] ${info}`, {
                    apiCalled: 'order:detail',
                    userType: session.user_type
                });
            }
            return this._enrichWithAI(sessionId, userMessage,
                `[DATA] Không tìm thấy đơn hàng #${orderId}.`,
                { userType: session.user_type });
        }

        // No orderId — show recent orders list
        const filters = isCustomer ? { customerId: session.user_id } : {};
        const result = await this.apiClient.getOrders(filters);
        if (result.success && result.data?.orders?.length) {
            const recent = result.data.orders.slice(0, 5);
            const list = recent.map(o => {
                const statusVi = statusLabels[o.status] || o.status;
                const paymentVi = paymentLabels[o.paymentStatus] || o.paymentStatus;
                return `- ${o.orderNumber}: ${statusVi} | ${paymentVi} | ${Number(o.total || 0).toLocaleString('vi-VN')}đ`;
            }).join('\n');
            return this._enrichWithAI(sessionId, userMessage,
                `[DATA] ${recent.length} đơn hàng gần nhất:\n${list}`,
                { apiCalled: 'order:list', userType: session.user_type });
        }

        return this._enrichWithAI(sessionId, userMessage,
            `[DATA] Chưa có đơn hàng nào.`,
            { userType: session.user_type });
    }

    async _handleSearchProduct(session, userMessage) {
        // Use RAG for semantic search if available
        if (this.ragService) {
            const storeId = (typeof session === 'object') ? (session.store_id || 1) : 1;
            const customerId = (typeof session === 'object' && session.user_type === 'customer') ? session.user_id : null;
            const sessionId = (typeof session === 'object') ? session.id : session;
            const chatHistory = await this._getRecentHistory(sessionId);

            const result = await this.ragService.recommend(
                userMessage, storeId, customerId, chatHistory
            );
            return {
                content: result.content,
                products: result.products,
                ragMetadata: result.metadata
            };
        }

        // Fallback: HTTP search via Catalog
        const sessionId = (typeof session === 'object') ? session.id : session;
        return this._handleSearchProductFallback(sessionId, userMessage);
    }

    async _handleSearchProductFallback(sessionId, userMessage) {
        const keyword = this._extractKeyword(userMessage, ['tìm', 'search', 'có gì', 'sản phẩm nào']);

        if (!this.apiClient) return this._fallbackNoApi('SEARCH_PRODUCT', keyword);

        const result = await this.apiClient.searchProducts(keyword);
        if (!result.success || !result.data?.products?.length) {
            return this._enrichWithAI(sessionId, userMessage,
                `[DATA] Không tìm thấy sản phẩm nào với từ khóa "${keyword}".`);
        }

        const products = result.data.products.slice(0, 8);
        const list = products.map(p =>
            `- ${p.name} | ${Number(p.unitPrice || 0).toLocaleString('vi-VN')}đ | ${p.isActive !== false ? 'Đang bán' : 'Ngừng bán'}`
        ).join('\n');

        return this._enrichWithAI(sessionId, userMessage,
            `[DATA] Tìm thấy ${result.data.products.length} sản phẩm:\n${list}`, 'catalog:search');
    }

    // ── Helpers ──────────────────────────────────

    /**
     * RAG Entity Resolution — Tìm sản phẩm bằng vector search (ngữ nghĩa).
     * Fallback sang catalog API (SQL ILIKE) nếu RAG không có kết quả.
     * 
     * Ví dụ: "sữa ông thọ" → vector search → match "Sữa đặc Ông Thọ trắng nhãn đỏ" (score 0.92)
     *        "coca" → match "Coca Cola lon 330ml"
     *        "nước ngọt đen" → semantic match → Coca Cola, Pepsi
     * 
     * @param {string} keyword - tên viết tắt/gõ tay từ user
     * @param {number} storeId
     * @param {number} limit - số SP tối đa
     * @returns {{ products: object[], source: 'rag'|'catalog'|null }}
     */
    async _resolveProductsByRAG(keyword, storeId, limit = 5) {
        // Step 1: Try RAG vector search (semantic understanding)
        if (this.ragService?.embeddingClient?.isReady) {
            try {
                const queryVector = await this.ragService.embeddingClient.embed(keyword);
                const ragResults = await this.ragService.knowledgeRepo.searchSemantic(
                    queryVector, storeId, limit
                );

                // Filter by relevance threshold (0.7 = strong semantic match)
                const relevant = ragResults.filter(r => r.score >= 0.7);
                if (relevant.length > 0) {
                    logger.info({ keyword, source: 'rag', count: relevant.length, topScore: relevant[0].score }, 'RAG entity resolution hit');
                    return {
                        source: 'rag',
                        products: relevant.map(r => ({
                            id: r.product_id,
                            name: r.content.match(/"([^"]+)"/)?.[1] || `Product ${r.product_id}`,
                            unitPrice: Number(r.unit_price),
                            categoryName: r.category_name,
                            quantityOnShelf: r.quantity_on_shelf,
                            image: null,
                            _ragScore: r.score
                        }))
                    };
                }
                logger.debug({ keyword, topScore: ragResults[0]?.score || 0 }, 'RAG entity resolution miss — below threshold');
            } catch (err) {
                logger.warn({ err, keyword }, 'RAG entity resolution failed — falling back to catalog');
            }
        }

        // Step 2: Fallback — Catalog API (SQL ILIKE)
        if (this.apiClient) {
            const result = await this.apiClient.searchProducts(keyword);
            if (result.success && result.data?.products?.length) {
                logger.info({ keyword, source: 'catalog', count: result.data.products.length }, 'Catalog fallback hit');
                return {
                    source: 'catalog',
                    products: result.data.products.slice(0, limit)
                };
            }
        }

        logger.info({ keyword }, 'Product resolution failed — no results from RAG or catalog');
        return { source: null, products: [] };
    }

    _extractKeyword(message, triggerWords) {
        const lower = message.toLowerCase();

        // Sort triggers longest-first to avoid partial matches
        // e.g. "giá bán" must match before "giá"
        const sorted = [...triggerWords].sort((a, b) => b.length - a.length);

        for (const trigger of sorted) {
            const idx = lower.indexOf(trigger);
            if (idx !== -1) {
                const after = message.substring(idx + trigger.length).trim();
                const before = message.substring(0, idx).trim();

                // If 'after' is a short filler word, prefer 'before'
                const fillerWords = ['không', 'nào', 'đi', 'nhé', 'vậy', 'ạ', 'đây', 'kia', 'thế', 'rồi', 'chưa', 'hả', 'hở', 'nha', 'luôn', 'tiền', 'vậy', 'hết'];
                const afterClean = after.replace(/[?!.,;:]/g, '').trim().toLowerCase();
                const isAfterFiller = !afterClean || fillerWords.includes(afterClean);

                let keyword = (isAfterFiller && before) ? before : (after || before);

                // Strip trailing filler words from keyword
                for (const filler of fillerWords) {
                    const regex = new RegExp(`\\s+${filler}\\s*$`, 'i');
                    keyword = keyword.replace(regex, '').trim();
                }

                // Strip common noise words users type before product names
                const noiseWords = ['sản phẩm', 'mặt hàng', 'sp', 'của', 'cái', 'con', 'loại', 'hàng', 'về', 'cho', 'tôi', 'mình', 'xem', 'kiểm tra', 'check'];
                for (const noise of noiseWords) {
                    if (keyword.toLowerCase().startsWith(noise)) {
                        keyword = keyword.substring(noise.length).trim();
                    }
                }

                return keyword.replace(/[?!.,;:]/g, '').trim() || message;
            }
        }
        return message;
    }

    _extractOrderId(message) {
        const match = message.match(/#?(\d{1,10})/);
        return match ? match[1] : null;
    }

    async _enrichWithAI(sessionId, userMessage, dataContext, {
        apiCalled = null,
        userType = 'employee',
        customerContext = null,
        coPurchaseHint = ''
    } = {}) {
        const chatHistory = await this.chatRepo.getRecentContext(sessionId, 5);

        const isCustomer = userType === 'customer';

        let systemHint;
        if (isCustomer) {
            const personalizationLine = customerContext?.prompt ? `\n${customerContext.prompt}` : '';
            const coPurchaseLine = coPurchaseHint ? `\n${coPurchaseHint}` : '';
            systemHint = `Bạn là nhân viên tư vấn siêu thị POSMART. Đóng vai trả lời khách hàng bằng tiếng Việt.\n` +
                `Quy tắc: Tùy biến cách diễn đạt tự nhiên, đa dạng. Nếu có thông tin mua kèm, gợi ý tự nhiên. Ngắn gọn, tối đa 3-4 câu.` +
                `${personalizationLine}${coPurchaseLine}`;
        } else {
            systemHint = `Bạn là trợ lý tra cứu cho nhân viên siêu thị POSMART. Trả lời chính xác, ngắn gọn, dựa trên dữ liệu hệ thống. Dùng định dạng số liệu rõ ràng.`;
        }

        const messages = [
            ...chatHistory.map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: `${userMessage}\n\n${dataContext}\n\n${systemHint}` }
        ];

        const aiResponse = await this.hfClient.chatCompletion(messages);
        return { ...aiResponse, apiCalled };
    }

    _fallbackNoApi(intent, keyword) {
        return {
            content: `Tôi hiểu bạn muốn ${intent === 'CHECK_STOCK' ? 'kiểm tra tồn kho' :
                intent === 'CHECK_PRICE' ? 'kiểm tra giá' :
                intent === 'ORDER_STATUS' ? 'tra cứu đơn hàng' :
                'tìm sản phẩm'}${keyword ? ` "${keyword}"` : ''}. ` +
                `Hiện tại hệ thống đang kết nối, vui lòng thử lại sau.`,
            model: null,
            latencyMs: 0,
            apiCalled: null
        };
    }

    _handleHelp() {
        const helpText = `Tôi có thể giúp bạn kiểm tra tồn kho, giá sản phẩm, trạng thái đơn hàng và gợi ý sản phẩm. Bạn muốn thử tính năng nào?`;

        return {
            content: helpText,
            model: null,
            latencyMs: 0,
            suggested_prompts: [
                'Kiểm tra tồn kho sữa',
                'Giá bán mì Hảo Hảo',
                'Đơn hàng gần đây',
                'Gợi ý sản phẩm bán chạy',
                'Tìm kiếm gia vị'
            ]
        };
    }

    async _handleFreeChat(sessionId, userMessage) {
        const chatHistory = await this.chatRepo.getRecentContext(sessionId, 8);
        const messages = [
            ...chatHistory.map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: userMessage }
        ];

        return await this.hfClient.chatCompletion(messages);
    }

    async _getRecentHistory(sessionId) {
        try {
            const messages = await this.chatRepo.getRecentContext(sessionId, 6);
            return messages.map(m => ({ role: m.role, content: m.content }));
        } catch (err) {
            logger.warn({ err, sessionId }, 'Failed to get chat history');
            return [];
        }
    }

    // ── Streaming Interface (WebSocket) ─────────────

    /**
     * Stream a response — yields { type, data } objects.
     * type = 'chunk' for text tokens, 'complete' for final metadata.
     * @param {number} sessionId
     * @param {string} userMessage
     * @yields {{ type: 'chunk', text: string } | { type: 'complete', intent: string, products: array, fullText: string }}
     */
    async *sendMessageStream(sessionId, userMessage) {
        if (!userMessage || userMessage.trim().length === 0) {
            throw new ValidationError('Message cannot be empty');
        }

        const session = await this.chatRepo.findSessionById(sessionId);
        if (!session) throw new NotFoundError('Chat session');
        if (!session.is_active) throw new ValidationError('Chat session has ended');

        const intentResult = resolveIntent(userMessage);
        logger.info({ sessionId, intent: intentResult.intent }, 'Stream: Intent resolved');

        await this.chatRepo.addMessage(sessionId, 'user', userMessage, intentResult.intent);

        let fullText = '';
        let products = null;
        let suggestedPrompts = null;
        let metadata = {};

        const needsRealStream = ['FREE_CHAT'].includes(intentResult.intent);

        if (needsRealStream) {
            // Real LLM streaming
            const chatHistory = await this.chatRepo.getRecentContext(sessionId, 8);
            const messages = [
                ...chatHistory.map(m => ({ role: m.role, content: m.content })),
                { role: 'user', content: userMessage }
            ];

            for await (const token of this.hfClient.chatCompletionStream(messages)) {
                fullText += token;
                yield { type: 'chunk', text: token };
            }

            metadata = { model: this.hfClient.model };
        } else {
            // Data intents — get full response then simulate stream
            let response;
            switch (intentResult.intent) {
                case 'CHECK_STOCK':
                    response = await this._handleCheckStock(session, userMessage);
                    break;
                case 'CHECK_PRICE':
                    response = await this._handleCheckPrice(session, userMessage);
                    break;
                case 'ORDER_STATUS':
                    response = await this._handleOrderStatus(session, userMessage);
                    break;
                case 'RECOMMENDATION':
                    response = await this._handleRecommendation(session, userMessage);
                    break;
                case 'SEARCH_PRODUCT':
                    response = await this._handleSearchProduct(session, userMessage);
                    break;
                case 'HELP':
                    response = this._handleHelp();
                    break;
                default:
                    response = await this._handleFreeChat(sessionId, userMessage);
                    break;
            }

            fullText = response.content;
            products = response.products || null;
            suggestedPrompts = response.suggested_prompts || null;
            metadata = { model: response.model, ragMetadata: response.ragMetadata || null };

            // Simulate streaming: yield 3-4 words at a time for smooth UX
            const words = fullText.split(/(\s+)/);
            let buffer = '';
            for (let i = 0; i < words.length; i++) {
                buffer += words[i];
                if ((i + 1) % 6 === 0 || i === words.length - 1) {
                    yield { type: 'chunk', text: buffer };
                    buffer = '';
                    // Small delay for visual effect (10ms)
                    await new Promise(r => setTimeout(r, 10));
                }
            }
        }

        // Save assistant message to DB
        await this.chatRepo.addMessage(sessionId, 'assistant', fullText, intentResult.intent, {
            model: metadata.model || null,
            intent: intentResult.intent,
        });

        // Final complete signal
        yield {
            type: 'complete',
            intent: intentResult.intent,
            products,
            suggestedPrompts,
            fullText,
            metadata
        };
    }
}

module.exports = ChatService;
