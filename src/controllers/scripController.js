const db = require('../config/db');

const getAllScrips = async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT * FROM scrip_data');
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

const updateScrip = async (req, res) => {
    const { symbol, lot_size, margin_req, status } = req.body;
    try {
        await db.execute(
            'UPDATE scrip_data SET lot_size = ?, margin_req = ?, status = ? WHERE symbol = ?',
            [lot_size, margin_req, status, symbol]
        );
        res.json({ message: 'Scrip updated' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

const getTickers = async (req, res) => {
    try {
        const userId = req.user.id;
        const userRole = req.user.role;

        // If ?all=true (admin panel), return only their created tickers
        if (req.query.all === 'true') {
            console.log(`[getTickers] User ${userId} (${userRole}) requesting all tickers`);

            let query = 'SELECT * FROM tickers WHERE created_by = ? OR created_by IS NULL ORDER BY id DESC';
            let params = [userId];

            // For SUPERADMIN/ADMIN, also include tickers created by their children
            if (userRole === 'SUPERADMIN' || userRole === 'ADMIN') {
                query = `SELECT * FROM tickers
                         WHERE created_by = ? OR created_by IN (
                             SELECT id FROM users WHERE parent_id = ?
                         ) OR created_by IS NULL
                         ORDER BY id DESC`;
                params = [userId, userId];
            }

            console.log(`[getTickers] Query params:`, params);
            const [rows] = await db.execute(query, params);
            console.log(`[getTickers] Returned ${rows.length} tickers`);
            return res.json(rows);
        }

        // For public view, only active tickers within schedule
        const [rows] = await db.execute(
            `SELECT * FROM tickers
             WHERE is_active = 1
               AND (start_time IS NULL OR start_time <= NOW())
               AND (end_time IS NULL OR end_time >= NOW())
             ORDER BY id DESC`
        );
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

const createTicker = async (req, res) => {
    const { text, start_time, end_time } = req.body;
    const userId = req.user.id;
    try {
        await db.execute(
            'INSERT INTO tickers (text, start_time, end_time, is_active, created_by) VALUES (?, ?, ?, ?, ?)',
            [text, start_time, end_time, 1, userId]
        );
        res.json({ message: 'Ticker created successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

const updateTicker = async (req, res) => {
    const { text, speed, is_active, start_time, end_time } = req.body;
    try {
        await db.execute(
            'UPDATE tickers SET text = ?, speed = ?, is_active = ?, start_time = ?, end_time = ? WHERE id = ?',
            [text, speed || 10, is_active ?? 1, start_time, end_time, req.params.id]
        );
        res.json({ message: 'Ticker updated' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

const deleteTicker = async (req, res) => {
    try {
        await db.execute('DELETE FROM tickers WHERE id = ?', [req.params.id]);
        res.json({ message: 'Ticker deleted successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

module.exports = { getAllScrips, updateScrip, getTickers, createTicker, updateTicker, deleteTicker };
