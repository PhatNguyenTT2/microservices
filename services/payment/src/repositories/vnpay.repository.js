/**
 * VNPay Transaction Repository
 * Lưu thông tin session thanh toán cổng VNPay
 */
class VNPayRepository {
     constructor(pool) {
         this.pool = pool;
     }
 
     async findByTxnRef(txnRef) {
         const query = 'SELECT * FROM vnpay_transaction WHERE vnp_txn_ref = $1';
         const { rows } = await this.pool.query(query, [txnRef]);
         return rows[0] || null;
     }
 
     async create(data) {
         const { payment_id, reference_id, vnp_txn_ref, vnp_amount, payment_url } = data;
         const query = `
             INSERT INTO vnpay_transaction 
             (payment_id, reference_id, vnp_txn_ref, vnp_amount, payment_url, status)
             VALUES ($1, $2, $3, $4, $5, 'pending')
             RETURNING *
         `;
         const { rows } = await this.pool.query(query, [
             payment_id, reference_id, vnp_txn_ref, vnp_amount, payment_url
         ]);
         return rows[0];
     }
 
     async completeTransaction(id, ipnData, isSuccess) {
         const status = isSuccess ? 'success' : 'failed';
         
         const query = `
             UPDATE vnpay_transaction 
             SET 
                 status = $1,
                 vnp_transaction_no = $2,
                 vnp_response_code = $3,
                 vnp_transaction_status = $4,
                 vnp_bank_code = $5,
                 vnp_bank_tran_no = $6,
                 vnp_card_type = $7,
                 vnp_pay_date = $8,
                 ipn_verified = TRUE
             WHERE id = $9
             RETURNING *
         `;
         const { rows } = await this.pool.query(query, [
             status,
             ipnData.vnp_TransactionNo,
             ipnData.vnp_ResponseCode,
             ipnData.vnp_TransactionStatus,
             ipnData.vnp_BankCode,
             ipnData.vnp_BankTranNo,
             ipnData.vnp_CardType,
             ipnData.vnp_PayDate,
             id
         ]);
         return rows[0];
     }

    // Saga: find pending VNPay transactions older than timeoutMinutes
    async findExpiredPending(timeoutMinutes = 15) {
        const query = `
            SELECT vt.*, p.store_id, p.reference_id AS order_id, p.reference_type
            FROM vnpay_transaction vt
            JOIN payment p ON vt.payment_id = p.id
            WHERE vt.status = 'pending'
              AND p.status = 'pending'
              AND p.payment_date < NOW() - INTERVAL '1 minute' * $1
        `;
        const { rows } = await this.pool.query(query, [timeoutMinutes]);
        return rows;
    }

    // Saga: mark transaction as expired
    async markExpired(id) {
        const query = `UPDATE vnpay_transaction SET status = 'expired' WHERE id = $1 RETURNING *`;
        const { rows } = await this.pool.query(query, [id]);
        return rows[0];
    }
}

module.exports = VNPayRepository;
