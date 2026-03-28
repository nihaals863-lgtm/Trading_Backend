const db = require('../config/db');

/**
 * Aggregated Accounts (Receivable/Payable)
 * Calculates net balance for all downline users.
 */
const getHierarchyAccounts = async (req, res) => {
    try {
        const query = `
            SELECT u.id, u.username, u.role, u.balance,
            (SELECT SUM(pnl) FROM trades WHERE user_id = u.id AND status = 'OPEN') as active_m2m
            FROM users u
            WHERE u.parent_id = ? OR u.id = ?
        `;
        const [rows] = await db.execute(query, [req.user.id, req.user.id]);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

const getNegativeBalances = async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT id, username, balance FROM users WHERE balance < 0');
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

module.exports = { getHierarchyAccounts, getNegativeBalances };
