const db = require('../config/db');

/**
 * Accounts Page — Hierarchy Accounts (Receivable/Payable)
 *
 * Logic:
 * - SUPERADMIN sees all BROKERs/ADMINs under them
 * - ADMIN sees all BROKERs under them
 * - For each broker: calculate their clients' total PL, brokerage, net
 * - Apply broker's share_pl_pct / share_brokerage_pct from broker_shares
 * - Determine Receivable (broker owes admin) or Payable (admin owes broker)
 */
const getHierarchyAccounts = async (req, res) => {
    try {
        const { fromDate, toDate } = req.query;
        const loggedInId = req.user.id;

        // Build date filter for trades
        let dateFilter = "t.status = 'CLOSED'";
        const dateParams = [];
        if (fromDate) {
            dateFilter += ' AND t.exit_time >= ?';
            dateParams.push(fromDate + ' 00:00:00');
        }
        if (toDate) {
            dateFilter += ' AND t.exit_time <= ?';
            dateParams.push(toDate + ' 23:59:59');
        }

        // Get all brokers/admins under logged-in user
        const [brokers] = await db.execute(
            `SELECT u.id, u.username, u.full_name, u.role, bs.share_pl_pct, bs.share_brokerage_pct
             FROM users u
             LEFT JOIN broker_shares bs ON bs.user_id = u.id
             WHERE u.parent_id = ? AND u.role IN ('BROKER','ADMIN','SUPERADMIN')`,
            [loggedInId]
        );

        const result = [];

        for (const broker of brokers) {
            // Get all clients under this broker
            const [clients] = await db.execute(
                'SELECT id FROM users WHERE parent_id = ? AND role = ?',
                [broker.id, 'TRADER']
            );

            if (!clients.length) {
                result.push({
                    broker: broker.username,
                    fullName: broker.full_name || '',
                    clientPL: '0.00',
                    clientBrokerage: '0.00',
                    clientNet: '0.00',
                    plShare: '0.00',
                    brokerageShare: '0.00',
                    netShare: '0.00',
                    receivablePayable: 'Receivable',
                });
                continue;
            }

            const clientIds = clients.map(c => c.id);
            const placeholders = clientIds.map(() => '?').join(',');

            // Sum of closed trades PnL for all clients of this broker
            const [plRows] = await db.execute(
                `SELECT
                    COALESCE(SUM(t.pnl), 0) AS total_pnl,
                    COALESCE(SUM(t.brokerage), 0) AS total_brokerage
                 FROM trades t
                 WHERE t.user_id IN (${placeholders}) AND ${dateFilter}`,
                [...clientIds, ...dateParams]
            );

            const clientPL = parseFloat(plRows[0]?.total_pnl || 0);
            const clientBrokerage = parseFloat(plRows[0]?.total_brokerage || 0);
            const clientNet = clientPL - clientBrokerage;

            const plSharePct = parseFloat(broker.share_pl_pct || 0) / 100;
            const brokerageSharePct = parseFloat(broker.share_brokerage_pct || 0) / 100;

            const plShare = clientPL * plSharePct;
            const brokerageShare = clientBrokerage * brokerageSharePct;
            const netShare = plShare - brokerageShare;

            // Receivable = broker owes admin (client lost money, admin profit)
            // Payable    = admin owes broker (client made money, broker gets share)
            const receivablePayable = netShare >= 0 ? 'Payable' : 'Receivable';

            result.push({
                broker: broker.username,
                fullName: broker.full_name || '',
                clientPL: clientPL.toFixed(2),
                clientBrokerage: clientBrokerage.toFixed(2),
                clientNet: clientNet.toFixed(2),
                plShare: plShare.toFixed(2),
                brokerageShare: brokerageShare.toFixed(2),
                netShare: netShare.toFixed(2),
                receivablePayable,
            });
        }

        res.json(result);
    } catch (err) {
        console.error('[AccountController] getHierarchyAccounts error:', err);
        res.status(500).json({ message: 'Server Error' });
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
