const { ValidationError, NotFoundError } = require('../../../../shared/common/errors');

class StoreService {
    constructor(storeRepo) {
        this.storeRepo = storeRepo;
    }

    async getStores() {
        return await this.storeRepo.findAll();
    }

    async getStore(id) {
        const store = await this.storeRepo.findById(id);
        if (!store) throw new NotFoundError('Store not found');
        return store;
    }

    async createStore(data) {
        const { name, address, phone, manager_id } = data;
        if (!name) throw new ValidationError('Store name is required');
        
        // MVP: Assume manager_id if provided is valid. 
        // Real-world: Check if user exists and has STORE_MANAGER role.
        return await this.storeRepo.create({ name, address, phone, manager_id });
    }
    
    async updateStore(id, data) {
         const store = await this.storeRepo.findById(id);
         if (!store) throw new NotFoundError('Store not found');
         return await this.storeRepo.update(id, data);
    }
}

module.exports = StoreService;
