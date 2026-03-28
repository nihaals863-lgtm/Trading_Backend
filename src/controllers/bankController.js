const db = require('../config/db');

const getBanks = async (req, res) => {
    try {
        const [rows] = await db.execute('SELECT * FROM bank_details ORDER BY id DESC');
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server Error' });
    }
};

const createBank = async (req, res) => {
    const { bankName, accountHolder, accountNumber, ifsc, branch } = req.body;
    if (!bankName || !accountHolder || !accountNumber || !ifsc || !branch) {
        return res.status(400).json({ message: 'All fields are required' });
    }
    try {
        const [result] = await db.execute(
            'INSERT INTO bank_details (bank_name, account_holder, account_number, ifsc, branch, status) VALUES (?, ?, ?, ?, ?, ?)',
            [bankName, accountHolder, accountNumber, ifsc, branch, 'Active']
        );
        res.status(201).json({ message: 'Bank added successfully', id: result.insertId });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server Error' });
    }
};

const updateBank = async (req, res) => {
    const { id } = req.params;
    const { bankName, accountHolder, accountNumber, ifsc, branch, status } = req.body;
    try {
        await db.execute(
            'UPDATE bank_details SET bank_name=?, account_holder=?, account_number=?, ifsc=?, branch=?, status=? WHERE id=?',
            [bankName, accountHolder, accountNumber, ifsc, branch, status || 'Active', id]
        );
        res.json({ message: 'Bank updated successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server Error' });
    }
};

const deleteBank = async (req, res) => {
    const { id } = req.params;
    try {
        await db.execute('DELETE FROM bank_details WHERE id = ?', [id]);
        res.json({ message: 'Bank deleted successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server Error' });
    }
};

const toggleBankStatus = async (req, res) => {
    const { id } = req.params;
    try {
        const [rows] = await db.execute('SELECT status FROM bank_details WHERE id = ?', [id]);
        if (!rows[0]) return res.status(404).json({ message: 'Bank not found' });
        const newStatus = rows[0].status === 'Active' ? 'Inactive' : 'Active';
        await db.execute('UPDATE bank_details SET status = ? WHERE id = ?', [newStatus, id]);
        res.json({ message: 'Status updated', status: newStatus });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Server Error' });
    }
};

module.exports = { getBanks, createBank, updateBank, deleteBank, toggleBankStatus };
