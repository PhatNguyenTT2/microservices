const express = require('express');
const { verifyToken } = require('../../../../shared/auth-middleware');

function createStoreRouter(storeService) {
    const router = express.Router();

    // Lấy danh sách cửa hàng
    router.get('/', async (req, res, next) => {
        try {
            const stores = await storeService.getStores();
            res.json({ status: 'success', data: { stores } });
        } catch (error) {
            next(error);
        }
    });

    // Lấy chi tiết cửa hàng
    router.get('/:id', async (req, res, next) => {
        try {
            const store = await storeService.getStore(req.params.id);
            res.json({ status: 'success', data: { store } });
        } catch (error) {
            next(error);
        }
    });

    // Tạo mới cửa hàng
    router.post('/', verifyToken, async (req, res, next) => {
        try {
            const newStore = await storeService.createStore(req.body);
            res.status(201).json({ status: 'success', data: { store: newStore } });
        } catch (error) {
            next(error);
        }
    });
    
    // Cập nhật cửa hàng
    router.put('/:id', verifyToken, async (req, res, next) => {
         try {
              const updatedStore = await storeService.updateStore(req.params.id, req.body);
              res.json({ status: 'success', data: { store: updatedStore } });
         } catch(error) {
              next(error);
         }
    });

    return router;
}

module.exports = createStoreRouter;
