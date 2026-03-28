const db = require('../config/db');

/**
 * Action Ledger - Logs every sensitive admin action
 */
const logAction = async (adminId, actionType, targetTable, description) => {
    try {
        await db.execute(
            'INSERT INTO action_ledger (admin_id, action_type, target_table, description) VALUES (?, ?, ?, ?)',
            [adminId, actionType, targetTable, description]
        );
    } catch (err) {
        console.error('Audit logging failed:', err);
    }
};

const getActionLedger = async (req, res) => {
    try {
        const { message, admin, start, end, page, limit, export: exportType } = req.query;
        const where = [];
        const params = [];

        if (message) {
            where.push('(a.description LIKE ? OR a.action_type LIKE ?)');
            params.push('%' + message + '%', '%' + message + '%');
        }
        if (admin) {
            where.push('u.username LIKE ?');
            params.push('%' + admin + '%');
        }
        if (start) {
            where.push('a.timestamp >= ?');
            params.push(start);
        }
        if (end) {
            where.push('a.timestamp <= ?');
            params.push(end);
        }

        const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
        const baseFrom = 'FROM action_ledger a JOIN users u ON a.admin_id = u.id';

        // Debug log
        console.log('[AUDIT] getActionLedger params:', { message, admin, start, end, page, limit, export: exportType });

        // If CSV export requested, return full filtered set (bounded by 5000)
        if (exportType === 'csv') {
            const csvLimit = 5000;
            const csvQuery = `SELECT a.*, u.username as admin_name ${baseFrom}${whereSql} ORDER BY a.timestamp DESC LIMIT ${csvLimit}`;
            const [rows] = await db.execute(csvQuery, params);
            const header = ['id', 'admin_id', 'admin_name', 'action_type', 'target_table', 'description', 'timestamp'];
            const csvLines = [header.join(',')];
            for (const r of rows) {
                const line = [r.id, r.admin_id, '"' + (r.admin_name || '') + '"', '"' + (r.action_type || '') + '"', '"' + (r.target_table || '') + '"', '"' + ((r.description || '').replace(/"/g, '""')) + '"', '"' + (r.timestamp || '') + '"'].join(',');
                csvLines.push(line);
            }
            const csv = csvLines.join('\n');
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="action_ledger.csv"');
            return res.send(csv);
        }

        // Total count
        const countSql = `SELECT COUNT(*) as total ${baseFrom}${whereSql}`;
        const [countRows] = await db.execute(countSql, params);
        const total = (countRows[0] && countRows[0].total) ? countRows[0].total : 0;

        // Pagination
        const pageNum = Math.max(1, parseInt(page || '1', 10));
        const pageSize = Math.min(parseInt(limit || '20', 10) || 20, 1000);
        const offset = (pageNum - 1) * pageSize;

        const dataQuery = `SELECT a.*, u.username as admin_name ${baseFrom}${whereSql} ORDER BY a.timestamp DESC LIMIT ? OFFSET ?`;
        const dataParams = params.concat([pageSize, offset]);
        const [rows] = await db.execute(dataQuery, dataParams);

        console.log('[AUDIT] returning rows:', rows.length, 'total:', total);
        res.json({ rows, total });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

// Debug: return last N action ledger entries (admin-only recommended)
const debugLatestActionLedger = async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit || '50', 10), 500);
        const [rows] = await db.execute(`SELECT a.*, u.username as admin_name FROM action_ledger a JOIN users u ON a.admin_id = u.id ORDER BY a.timestamp DESC LIMIT ?`, [limit]);
        return res.json({ success: true, rows });
    } catch (err) {
        console.error('[AUDIT DEBUG] error:', err.message || err);
        return res.status(500).json({ success: false, message: err.message || 'Error' });
    }
};

/**
 * Global Updation - Batch update segments/limits for all users
 */
const globalBatchUpdate = async (req, res) => {
    const { segment, status, limitUpdate } = req.body;
    // status: OPEN/CLOSE, limitUpdate: { field: value }

    try {
        // This is a high-stakes batch operation
        if (status) {
            await db.execute(`UPDATE client_settings SET ${segment}_enabled = ?`, [status === 'OPEN' ? 1 : 0]);
            await logAction(req.user.id, 'BATCH_UPDATE', 'client_settings', `Global ${segment} status set to ${status}`);
        } else if (limitUpdate) {
            // Handle limit updates if logic is added here later
            await logAction(req.user.id, 'BATCH_UPDATE', 'client_settings', `Global ${segment} limits updated`);
        }
        
        res.json({ message: 'Global update completed' });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

module.exports = { getActionLedger, globalBatchUpdate, logAction, debugLatestActionLedger };
