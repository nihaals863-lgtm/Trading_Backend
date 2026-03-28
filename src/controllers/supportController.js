const db = require('../config/db');

const createTicket = async (req, res) => {
    const { subject, message, priority } = req.body;
    try {
        const [result] = await db.execute(
            'INSERT INTO support_tickets (user_id, subject, message, priority) VALUES (?, ?, ?, ?)',
            [req.user.id, subject, message, priority || 'NORMAL']
        );
        res.status(201).json({ message: 'Ticket raised', id: result.insertId });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

const getTickets = async (req, res) => {
    try {
        let query = 'SELECT t.*, u.username FROM support_tickets t JOIN users u ON t.user_id = u.id';
        const params = [];

        if (req.user.role !== 'SUPERADMIN' && req.user.role !== 'ADMIN') {
            query += ' WHERE t.user_id = ?';
            params.push(req.user.id);
        }

        const [rows] = await db.execute(query, params);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

const replyTicket = async (req, res) => {
    const { reply } = req.body;
    try {
        await db.execute(
            'UPDATE support_tickets SET admin_reply = ?, status = "RESOLVED" WHERE id = ?',
            [reply, req.params.id]
        );
        res.json({ message: 'Reply sent' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

module.exports = { createTicket, getTickets, replyTicket };
