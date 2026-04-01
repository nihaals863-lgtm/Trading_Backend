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
        // If ?all=true (admin panel), return everything; otherwise only active tickers within schedule
        if (req.query.all === 'true') {
            const [rows] = await db.execute('SELECT * FROM tickers ORDER BY id DESC');
            return res.json(rows);
        }
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
    try {
        await db.execute(
            'INSERT INTO tickers (text, start_time, end_time, is_active) VALUES (?, ?, ?, ?)',
            [text, start_time, end_time, 1]
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
