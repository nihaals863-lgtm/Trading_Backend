const db = require('../config/db');
const { logAction } = require('./systemController');
const mockEngine = require('../utils/mockEngine');
const bcrypt = require('bcryptjs');


/**
 * Place a New Order
 */
const placeOrder = async (req, res) => {
    const {
        symbol, type, qty, price,
        order_type = 'MARKET',
        is_pending = false,
        userId: traderId,
        transactionPassword
    } = req.body;

    const requesterId = req.user.id;
    const requesterRole = req.user.role;
    const tradeIp = req.ip || req.headers['x-forwarded-for'] || '127.0.0.1';

    try {
        console.log('--- Place Order Request ---');
        console.log('Body:', JSON.stringify(req.body, null, 2));
        console.log('Incoming types:', { symbol: typeof symbol, type: typeof type, qtyType: typeof qty, qtyValue: qty });

        // 1. Basic Field Validation
        // Accept numeric strings for qty; treat undefined, null, or empty-string as missing
        const missing = [];
        if (!symbol) missing.push('symbol');
        if (!type) missing.push('type');
        if (qty === undefined || qty === null || qty === '') missing.push('qty');
        if (missing.length > 0) {
            return res.status(400).json({ message: 'Missing required fields: ' + missing.join(', ') });
        }

        // 2. Determine target user (Trader)
        let targetUserId = requesterId;
        if (requesterRole !== 'TRADER' && traderId) {
            targetUserId = traderId;
        }

        // 3. Validate User Exists and Get Balance/Password
        const [userRows] = await db.execute(
            'SELECT id, balance, transaction_password, role FROM users WHERE id = ?',
            [targetUserId]
        );
        const targetUser = userRows[0];
        if (!targetUser) {
            return res.status(404).json({ message: 'Target user not found' });
        }

        // 4. Validate Transaction Password for the requester
        const [requesterRows] = await db.execute(
            'SELECT transaction_password FROM users WHERE id = ?',
            [requesterId]
        );
        const requester = requesterRows[0];

        if (!requester || !requester.transaction_password) {
            return res.status(400).json({ message: 'Your transaction password is not set' });
        }

        if (!transactionPassword) {
            return res.status(400).json({ message: 'Transaction password is required' });
        }

        const isMatch = await bcrypt.compare(transactionPassword, requester.transaction_password);
        if (!isMatch) {
            return res.status(403).json({ message: 'Invalid transaction password' });
        }

        // 5. Execution Price Logic
        const currentPrice = mockEngine.getPrice(symbol);
        const executionPrice = (order_type === 'MARKET' || !price) ? currentPrice : parseFloat(price);
        const qtyNum = parseInt(qty, 10);

        if (isNaN(executionPrice) || executionPrice <= 0) {
            return res.status(400).json({ message: 'Invalid price for the selected scrip' });
        }
        if (isNaN(qtyNum) || qtyNum <= 0) {
            return res.status(400).json({ message: 'Quantity must be a positive number' });
        }

        // 6. Basic Margin/Balance Check (Placeholder: 10% margin requirement)
        const totalValue = executionPrice * qtyNum;
        const marginRequired = totalValue * 0.1; // 10% Margin

        if (targetUser.balance < marginRequired) {
            const avail = parseFloat(targetUser.balance || 0).toFixed(2);
            return res.status(400).json({
                message: `Insufficient balance. Required margin: ₹${marginRequired.toFixed(2)}, Available: ₹${avail}`,
                required: marginRequired.toFixed(2),
                available: avail
            });
        }

        // 7. Detect market_type from symbol
        const sym = symbol.toUpperCase();
        const MCX_SYMBOLS = ['GOLD', 'GOLDM', 'SILVER', 'SILVERM', 'CRUDEOIL', 'COPPER', 'NICKEL', 'ZINC', 'LEAD', 'ALUMINIUM', 'ALUMINI', 'NATURALGAS', 'MENTHAOIL', 'COTTON', 'BULLDEX', 'CRUDEOIL MINI', 'ZINCMINI', 'LEADMINI', 'SILVER MIC'];
        let marketType = 'MCX';
        if (MCX_SYMBOLS.some(s => sym.includes(s))) {
            marketType = 'MCX';
        } else if (sym.includes('/') || ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD'].some(f => sym.includes(f))) {
            marketType = 'FOREX';
        } else if (['BTC', 'ETH', 'SOL', 'USDT'].some(c => sym.includes(c))) {
            marketType = 'CRYPTO';
        } else if (['GC', 'SI', 'HG', 'CL'].some(c => sym.startsWith(c))) {
            marketType = 'COMEX';
        } else {
            marketType = 'EQUITY';
        }

        // Also check if scrip_data has market_type defined
        try {
            const [scripRows] = await db.execute('SELECT market_type FROM scrip_data WHERE symbol = ?', [sym]);
            if (scripRows.length > 0 && scripRows[0].market_type) {
                marketType = scripRows[0].market_type;
            }
        } catch (_) { /* scrip_data may not have market_type column yet */ }

        console.log('Executing with:', { targetUserId, symbol, type, executionPrice, marginRequired, marketType });

        // 8. Insert Trade
        const [result] = await db.execute(
            `INSERT INTO trades
                (user_id, symbol, type, order_type, qty, entry_price, margin_used, is_pending, market_type, status, trade_ip)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                targetUserId,
                sym,
                type.toUpperCase(),
                order_type,
                qtyNum,
                executionPrice,
                marginRequired,
                is_pending ? 1 : 0,
                marketType,
                'OPEN',
                tradeIp
            ]
        );

        // 8. Deduct Margin from Balance
        await db.execute(
            'UPDATE users SET balance = balance - ? WHERE id = ?',
            [marginRequired, targetUserId]
        );

        console.log('✅ Trade Inserted:', result.insertId);
        res.status(201).json({
            message: 'Order placed successfully',
            tradeId: result.insertId,
            executionPrice,
            marginUsed: marginRequired
        });

        // Log the trade placement
        await logAction(requesterId, 'PLACE_ORDER', 'trades', `Placed ${type.toUpperCase()} order for ${sym} (Qty: ${qtyNum}, Price: ${executionPrice}) for user #${targetUserId}`);


    } catch (err) {
        console.error('❌ Trade Placement Error:', err);
        res.status(500).json({ message: 'Internal Server Error', error: err.message });
    }
};

/**
 * Get Trades by Status (Active, Closed, Deleted)
 */
const getTrades = async (req, res) => {
    const { status, user_id } = req.query; // OPEN, CLOSED, DELETED, CANCELLED
    try {
        let query = 'SELECT t.*, u.username FROM trades t JOIN users u ON t.user_id = u.id WHERE 1=1';
        const params = [];

        if (status) {
            query += ' AND t.status = ?';
            params.push(status);
        }

        if (req.query.is_pending !== undefined) {
            query += ' AND t.is_pending = ?';
            params.push(req.query.is_pending === 'true' || req.query.is_pending === '1' ? 1 : 0);
        }

        // Filter by specific user_id (for client detail views)
        if (user_id) {
            query += ' AND t.user_id = ?';
            params.push(user_id);
        } else if (req.user.role !== 'SUPERADMIN') {
            // Apply role hierarchy filtering only when not filtering by specific user
            query += ' AND (u.id = ? OR u.parent_id = ?)';
            params.push(req.user.id, req.user.id);
        }

        query += ' ORDER BY t.entry_time DESC';
        const [rows] = await db.execute(query, params);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

const getGroupTrades = async (req, res) => {
    try {
        const { id, role } = req.user;
        let query = `
            SELECT 
                t.symbol, 
                t.type, 
                t.market_type,
                SUM(t.qty) as total_qty, 
                AVG(t.entry_price) as avg_price, 
                COUNT(*) as trade_count
            FROM trades t
            JOIN users u ON t.user_id = u.id
            WHERE t.status = 'OPEN'
        `;
        const params = [];

        // Hierarchy Isolation: Superadmin sees everything, others see only their downline
        if (role !== 'SUPERADMIN') {
            query += ` AND (u.id = ? OR u.parent_id = ? OR u.parent_id IN (SELECT id FROM users WHERE parent_id = ?))`;
            params.push(id, id, id);
        }

        query += ` GROUP BY t.symbol, t.type, t.market_type ORDER BY t.symbol ASC`;

        const [rows] = await db.execute(query, params);
        res.json(rows);
    } catch (err) {

        console.error(err);
        res.status(500).send('Server Error');
    }
};

/**
 * Close/Square-off Trade
 */
const closeTrade = async (req, res) => {
    const { exitPrice } = req.body;
    try {
        const [trades] = await db.execute('SELECT * FROM trades WHERE id = ?', [req.params.id]);
        if (trades.length === 0) return res.status(404).json({ message: 'Trade not found' });

        const trade = trades[0];
        if (trade.status !== 'OPEN') {
            return res.status(400).json({ message: 'Trade is already closed or inactive' });
        }

        const currentPrice = mockEngine.getPrice(trade.symbol);
        const finalExitPrice = exitPrice || currentPrice;

        const pnl = trade.type === 'BUY'
            ? (finalExitPrice - trade.entry_price) * trade.qty
            : (trade.entry_price - finalExitPrice) * trade.qty;

        // Release margin + Add/Subtract PnL
        const marginToRelease = parseFloat(trade.margin_used || 0);
        const balanceChange = pnl + marginToRelease;

        await db.execute(
            'UPDATE trades SET status = "CLOSED", exit_price = ?, exit_time = NOW(), pnl = ? WHERE id = ?',
            [finalExitPrice, pnl, req.params.id]
        );

        // Update User Balance
        await db.execute(
            'UPDATE users SET balance = balance + ? WHERE id = ?',
            [balanceChange, trade.user_id]
        );

        console.log(`✅ Trade ${trade.id} closed. PnL: ${pnl}, Margin Released: ${marginToRelease}, Balance Change: ${balanceChange}`);
        
        // Log the action (Audit)
        await logAction(req.user.id || trade.user_id, 'CLOSE_TRADE', 'trades', `Closed trade ID #${trade.id} @ ${finalExitPrice}. PnL: ${pnl}`);

        res.json({

            message: 'Trade closed successfully',
            pnl,
            marginReleased: marginToRelease,
            newBalanceChange: balanceChange
        });
    } catch (err) {
        console.error('❌ Close Trade Error:', err);
        res.status(500).send('Server Error');
    }
};

/**
 * Soft Delete Trade (Audit Trail) — refunds margin + PnL back to user
 */
const deleteTrade = async (req, res) => {
    try {
        // Verify transaction password if provided
        if (req.body && req.body.transactionPassword) {
            const [users] = await db.execute('SELECT transaction_password FROM users WHERE id = ?', [req.user.id]);
            if (users.length && users[0].transaction_password) {
                const match = await bcrypt.compare(req.body.transactionPassword, users[0].transaction_password);
                if (!match) return res.status(403).json({ message: 'Invalid transaction password' });
            }
        }

        const [trades] = await db.execute('SELECT * FROM trades WHERE id = ?', [req.params.id]);
        if (trades.length === 0) return res.status(404).json({ message: 'Trade not found' });

        const trade = trades[0];
        if (trade.status === 'DELETED') return res.status(400).json({ message: 'Trade already deleted' });

        // Refund: margin + PnL (for CLOSED trades) or just margin (for OPEN trades)
        const marginToRefund = parseFloat(trade.margin_used || 0);
        const pnlToRefund = trade.status === 'CLOSED' ? parseFloat(trade.pnl || 0) : 0;
        const balanceRefund = marginToRefund + pnlToRefund;

        await db.execute('UPDATE trades SET status = "DELETED" WHERE id = ?', [req.params.id]);

        if (balanceRefund !== 0) {
            await db.execute('UPDATE users SET balance = balance + ? WHERE id = ?', [balanceRefund, trade.user_id]);
        }

        await logAction(req.user.id, 'DELETE_TRADE', 'trades', `Deleted trade #${req.params.id}. Refunded margin: ${marginToRefund}, PnL: ${pnlToRefund}`);

        res.json({ message: 'Trade deleted and refunded', marginRefunded: marginToRefund, pnlRefunded: pnlToRefund });
    } catch (err) {
        console.error('Delete Trade Error:', err);
        res.status(500).json({ message: 'Server Error' });
    }
};

/**
 * Update Trade (modify entry_price, exit_price, qty)
 */
const updateTrade = async (req, res) => {
    try {
        const { entry_price, exit_price, qty, transactionPassword } = req.body;

        // Verify transaction password
        if (transactionPassword) {
            const [users] = await db.execute('SELECT transaction_password FROM users WHERE id = ?', [req.user.id]);
            if (users.length && users[0].transaction_password) {
                const match = await bcrypt.compare(transactionPassword, users[0].transaction_password);
                if (!match) return res.status(403).json({ message: 'Invalid transaction password' });
            }
        }

        const [trades] = await db.execute('SELECT * FROM trades WHERE id = ?', [req.params.id]);
        if (trades.length === 0) return res.status(404).json({ message: 'Trade not found' });

        const trade = trades[0];

        // Build dynamic update
        const updates = [];
        const params = [];

        if (qty !== undefined && qty !== '' && qty !== null) {
            const newQty = parseInt(qty);
            if (newQty <= 0) return res.status(400).json({ message: 'Quantity must be positive' });
            updates.push('qty = ?');
            params.push(newQty);

            // Recalculate margin: price * qty * 0.1
            const price = entry_price ? parseFloat(entry_price) : parseFloat(trade.entry_price);
            const newMargin = price * newQty * 0.1;
            const oldMargin = parseFloat(trade.margin_used || 0);
            const marginDiff = newMargin - oldMargin;

            updates.push('margin_used = ?');
            params.push(newMargin);

            // Adjust user balance for margin difference
            if (marginDiff !== 0) {
                await db.execute('UPDATE users SET balance = balance - ? WHERE id = ?', [marginDiff, trade.user_id]);
            }
        }

        if (entry_price !== undefined && entry_price !== '' && entry_price !== null) {
            updates.push('entry_price = ?');
            params.push(parseFloat(entry_price));
        }

        if (exit_price !== undefined && exit_price !== '' && exit_price !== null) {
            updates.push('exit_price = ?');
            params.push(parseFloat(exit_price));

            // Recalculate PnL if both entry and exit price exist
            const entryP = entry_price ? parseFloat(entry_price) : parseFloat(trade.entry_price);
            const exitP = parseFloat(exit_price);
            const q = qty ? parseInt(qty) : trade.qty;
            const pnl = trade.type === 'BUY' ? (exitP - entryP) * q : (entryP - exitP) * q;
            updates.push('pnl = ?');
            params.push(pnl);
        }

        if (updates.length === 0) return res.status(400).json({ message: 'No fields to update' });

        params.push(req.params.id);
        await db.execute(`UPDATE trades SET ${updates.join(', ')} WHERE id = ?`, params);

        await logAction(req.user.id, 'UPDATE_TRADE', 'trades', `Updated trade #${req.params.id}: ${updates.map(u => u.split(' =')[0]).join(', ')}`);

        res.json({ message: 'Trade updated successfully' });
    } catch (err) {
        console.error('Update Trade Error:', err);
        res.status(500).json({ message: 'Server Error' });
    }
};

/**
 * Restore Trade — reopens a CLOSED trade by removing exit data
 * Reverses the close: removes exit_price, exit_time, resets PnL, re-deducts margin from balance
 */
const restoreTrade = async (req, res) => {
    try {
        const { transactionPassword } = req.body;

        // Verify transaction password
        if (transactionPassword) {
            const [users] = await db.execute('SELECT transaction_password FROM users WHERE id = ?', [req.user.id]);
            if (users.length && users[0].transaction_password) {
                const match = await bcrypt.compare(transactionPassword, users[0].transaction_password);
                if (!match) return res.status(403).json({ message: 'Invalid transaction password' });
            }
        }

        const [trades] = await db.execute('SELECT * FROM trades WHERE id = ?', [req.params.id]);
        if (trades.length === 0) return res.status(404).json({ message: 'Trade not found' });

        const trade = trades[0];
        if (trade.status !== 'CLOSED') {
            return res.status(400).json({ message: 'Only CLOSED trades can be restored' });
        }

        // Reverse the close: take back PnL + margin that was released, then re-lock margin
        const pnl = parseFloat(trade.pnl || 0);
        const margin = parseFloat(trade.margin_used || 0);
        // On close: balance += pnl + margin. To reverse: balance -= (pnl + margin) then balance += 0 (margin stays locked)
        // Net: balance -= pnl (refund the PnL reversal, keep margin locked)
        const balanceDeduction = pnl; // Remove the PnL that was credited on close

        // Reopen the trade
        await db.execute(
            'UPDATE trades SET status = "OPEN", exit_price = NULL, exit_time = NULL, pnl = 0 WHERE id = ?',
            [req.params.id]
        );

        // Reverse balance: deduct the PnL that was added on close
        if (balanceDeduction !== 0) {
            await db.execute('UPDATE users SET balance = balance - ? WHERE id = ?', [balanceDeduction, trade.user_id]);
        }

        await logAction(req.user.id, 'RESTORE_TRADE', 'trades', `Restored trade #${req.params.id} to OPEN. PnL reversed: ${pnl}`);

        res.json({ message: 'Trade restored to OPEN', pnlReversed: pnl });
    } catch (err) {
        console.error('Restore Trade Error:', err);
        res.status(500).json({ message: 'Server Error' });
    }
};

module.exports = { placeOrder, getTrades, getGroupTrades, closeTrade, deleteTrade, updateTrade, restoreTrade };
