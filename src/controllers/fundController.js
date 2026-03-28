const db = require('../config/db');

const createFund = async (req, res) => {
    const { userId, amount, notes, mode } = req.body; 
    const type = mode === 'deposit' ? 'DEPOSIT' : 'WITHDRAW';

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Get Current Balance
        const [userRows] = await connection.execute('SELECT balance FROM users WHERE id = ? FOR UPDATE', [userId]);
        if (userRows.length === 0) throw new Error('User not found');
        
        const currentBalance = parseFloat(userRows[0].balance || 0);
        const amountNum = parseFloat(amount);
        const newBalance = type === 'DEPOSIT' ? currentBalance + amountNum : currentBalance - amountNum;

        // 2. Record in Ledger
        await connection.execute(
            'INSERT INTO ledger (user_id, amount, type, balance_after, remarks) VALUES (?, ?, ?, ?, ?)',
            [userId, amountNum, type, newBalance, notes]
        );

        // 3. Update User Balance
        await connection.execute(
            'UPDATE users SET balance = ? WHERE id = ?',
            [newBalance, userId]
        );

        await connection.commit();
        res.json({ message: 'Transaction successful', newBalance });
    } catch (err) {
        await connection.rollback();
        console.error(err);
        res.status(500).json({ message: err.message || 'Server Error' });
    } finally {
        connection.release();
    }
};

const getFunds = async (req, res) => {
    try {
        const { userId, amount } = req.query;
        let query = `
            SELECT l.*, u.username, u.full_name 
            FROM ledger l 
            JOIN users u ON l.user_id = u.id 
            WHERE 1=1
        `;
        const params = [];

        if (userId) {
            query += " AND u.username LIKE ?";
            params.push(`%${userId}%`);
        }
        if (amount) {
            query += " AND l.amount = ?";
            params.push(amount);
        }

        query += " ORDER BY l.created_at DESC";

        const [rows] = await db.execute(query, params);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

module.exports = { createFund, getFunds };
