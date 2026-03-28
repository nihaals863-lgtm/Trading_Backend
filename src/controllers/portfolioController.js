const db = require('../config/db');

const getLedger = async (req, res) => {
    try {
        const { userId, type } = req.query; // type: CREDIT/DEBIT
        let query = 'SELECT * FROM internal_transfers';
        const params = [];

        if (userId) {
            query += ' WHERE to_user_id = ? OR from_user_id = ?';
            params.push(userId, userId);
        }

        const [rows] = await db.execute(query, params);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

const internalTransfer = async (req, res) => {
    const { toUserId, amount, notes } = req.body;
    const fromUserId = req.user.id;
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        // Check balance of sender if not SUPERADMIN
        if (req.user.role !== 'SUPERADMIN') {
            const [sender] = await connection.execute('SELECT balance FROM users WHERE id = ?', [fromUserId]);
            if (sender[0].balance < amount) throw new Error('Insufficient balance');
        }

        // Update balances
        await connection.execute('UPDATE users SET balance = balance - ? WHERE id = ?', [amount, fromUserId]);
        await connection.execute('UPDATE users SET balance = balance + ? WHERE id = ?', [amount, toUserId]);

        // Log transfer
        await connection.execute(
            'INSERT INTO internal_transfers (from_user_id, to_user_id, amount, notes) VALUES (?, ?, ?, ?)',
            [fromUserId, toUserId, amount, notes]
        );

        await connection.commit();
        res.json({ message: 'Transfer successful' });
    } catch (err) {
        await connection.rollback();
        res.status(400).json({ message: err.message });
    } finally {
        connection.release();
    }
};

module.exports = { getLedger, internalTransfer };
