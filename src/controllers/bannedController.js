const db = require('../config/db');

const getBannedOrders = async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT * FROM banned_limit_orders ORDER BY id DESC');
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server Error' });
    }
};

const createBannedOrder = async (req, res) => {
    const { scripId, startTime, endTime } = req.body;
    try {
        const [result] = await db.execute(
            'INSERT INTO banned_limit_orders (scrip_id, start_time, end_time) VALUES (?, ?, ?)',
            [scripId, startTime, endTime]
        );
        res.status(201).json({ message: 'Scrip banned successfully', id: result.insertId });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server Error' });
    }
};

const deleteBannedOrder = async (req, res) => {
    const { id } = req.params;
    try {
        await db.execute('DELETE FROM banned_limit_orders WHERE id = ?', [id]);
        res.json({ message: 'Ban removed successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server Error' });
    }
};

const deleteMultipleBannedOrders = async (req, res) => {
    const { ids } = req.body; // Array of IDs
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: 'No IDs provided' });
    }
    try {
        const placeholders = ids.map(() => '?').join(',');
        const sql = `DELETE FROM banned_limit_orders WHERE id IN (${placeholders})`;
        await db.execute(sql, ids);
        res.json({ message: 'Bans removed successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server Error' });
    }
};

module.exports = {
    getBannedOrders,
    createBannedOrder,
    deleteBannedOrder,
    deleteMultipleBannedOrders
};
