const db = require('../config/db');
const { logAction } = require('./systemController');

const createFund = async (req, res) => {
    const { userId, amount, notes, mode } = req.body;
    const type = mode === 'deposit' ? 'DEPOSIT' : 'WITHDRAW';
    const role = req.user.role;
    const loggedInId = req.user.id;

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Get Current Balance + verify ownership
        const [userRows] = await connection.execute('SELECT balance, parent_id FROM users WHERE id = ? FOR UPDATE', [userId]);
        if (userRows.length === 0) throw new Error('User not found');

        // Broker can only fund their own directly assigned clients
        if (role === 'BROKER' && userRows[0].parent_id !== loggedInId) {
            await connection.rollback();
            return res.status(403).json({ message: 'You can only manage funds for your own clients' });
        }

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

        // Log the fund creation
        await logAction(req.user.id, 'CREATE_FUND', 'ledger', `${type} of ${amountNum} for user #${userId}. Notes: ${notes || 'N/A'}`);
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
        const role = req.user.role;
        const loggedInId = req.user.id;

        let query = `
            SELECT l.*, u.username, u.full_name
            FROM ledger l
            JOIN users u ON l.user_id = u.id
            WHERE 1=1
        `;
        const params = [];

        // Role-based hierarchy filter
        if (role === 'SUPERADMIN') {
            // sees all
        } else if (role === 'ADMIN') {
            // sees all traders/brokers under them (any depth) via subquery
            query += ` AND l.user_id IN (
                SELECT id FROM users WHERE parent_id = ?
                UNION
                SELECT u2.id FROM users u2
                JOIN users u3 ON u2.parent_id = u3.id
                WHERE u3.parent_id = ?
            )`;
            params.push(loggedInId, loggedInId);
        } else {
            // BROKER — only directly assigned clients
            query += ` AND u.parent_id = ?`;
            params.push(loggedInId);
        }

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

const updateFund = async (req, res) => {
    const { id } = req.params;
    const { amount, notes, mode } = req.body;
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Get existing entry
        const [rows] = await connection.execute('SELECT * FROM ledger WHERE id = ?', [id]);
        if (rows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Fund entry not found' });
        }

        const old = rows[0];
        const oldAmount = parseFloat(old.amount);
        const newAmount = parseFloat(amount);
        const newType = mode === 'deposit' ? 'DEPOSIT' : 'WITHDRAW';

        // 2. Reverse old balance effect
        const oldReverse = old.type === 'DEPOSIT' ? -oldAmount : oldAmount;

        // 3. Apply new balance effect
        const newEffect = newType === 'DEPOSIT' ? newAmount : -newAmount;

        const balanceChange = oldReverse + newEffect;

        // 4. Update user balance
        await connection.execute(
            'UPDATE users SET balance = balance + ? WHERE id = ?',
            [balanceChange, old.user_id]
        );

        // 5. Get new balance for ledger
        const [userRows] = await connection.execute('SELECT balance FROM users WHERE id = ?', [old.user_id]);
        const newBalance = parseFloat(userRows[0]?.balance || 0);

        // 6. Update ledger entry
        await connection.execute(
            'UPDATE ledger SET amount = ?, type = ?, remarks = ?, balance_after = ? WHERE id = ?',
            [newAmount, newType, notes || old.remarks, newBalance, id]
        );

        await connection.commit();
        res.json({ message: 'Fund entry updated successfully', newBalance });

        // Log the fund update
        await logAction(req.user.id, 'UPDATE_FUND', 'ledger', `Updated fund entry #${id}. New Amount: ${newAmount}, New Type: ${newType}`);
    } catch (err) {
        await connection.rollback();
        console.error('Update Fund Error:', err);
        res.status(500).json({ message: 'Failed to update fund entry' });
    } finally {
        connection.release();
    }
};

const deleteFund = async (req, res) => {
    const { id } = req.params;
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // 1. Get the ledger entry
        const [rows] = await connection.execute('SELECT * FROM ledger WHERE id = ?', [id]);
        if (rows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Fund entry not found' });
        }

        const entry = rows[0];
        const amount = parseFloat(entry.amount);

        // 2. Reverse the balance change
        // If it was DEPOSIT, subtract the amount. If WITHDRAW, add it back.
        const reverseAmount = entry.type === 'DEPOSIT' ? -amount : amount;
        await connection.execute(
            'UPDATE users SET balance = balance + ? WHERE id = ?',
            [reverseAmount, entry.user_id]
        );

        // 3. Delete the ledger entry
        await connection.execute('DELETE FROM ledger WHERE id = ?', [id]);

        await connection.commit();
        res.json({ message: 'Fund entry deleted and balance reversed' });

        // Log the fund deletion
        await logAction(req.user.id, 'DELETE_FUND', 'ledger', `Deleted fund entry #${id} for user #${entry.user_id}. Reversed amount: ${reverseAmount}`);
    } catch (err) {
        await connection.rollback();
        console.error('Delete Fund Error:', err);
        res.status(500).json({ message: 'Failed to delete fund entry' });
    } finally {
        connection.release();
    }
};

module.exports = { createFund, getFunds, updateFund, deleteFund };
