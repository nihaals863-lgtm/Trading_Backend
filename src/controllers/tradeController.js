const db = require('../config/db');
const { logAction } = require('./systemController');
const mockEngine = require('../utils/mockEngine');
const bcrypt = require('bcryptjs');
const { invalidateCache } = require('../utils/cacheManager');


/**
 * Place a New Order
 */
const placeOrder = async (req, res) => {
    // Safety check: ensure req.body exists
    console.log('[placeOrder] Request received:');
    console.log('  Method:', req.method);
    console.log('  URL:', req.url);
    console.log('  Content-Type:', req.headers['content-type']);
    console.log('  Body type:', typeof req.body);
    console.log('  Body is Array:', Array.isArray(req.body));
    console.log('  Body keys:', req.body ? Object.keys(req.body) : 'N/A');
    console.log('  Body:', JSON.stringify(req.body, null, 2));

    if (!req.body || Object.keys(req.body).length === 0) {
        console.error('[placeOrder] ERROR: req.body is empty or undefined!');
        console.error('[placeOrder] Request headers:', req.headers);
        return res.status(400).json({ message: 'Request body is empty. Please check your request format.' });
    }

    const {
        symbol, type, qty, price,
        order_type = 'MARKET',
        is_pending = false,
        userId: traderId,
        transactionPassword,
        exit_price
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

        // 5. Banned Limit Order Check
        if (order_type !== 'MARKET') {
            const now = new Date();
            const [bans] = await db.execute(
                'SELECT id FROM banned_limit_orders WHERE scrip_id = ? AND start_time <= ? AND end_time >= ?',
                [symbol, now, now]
            );
            if (bans.length > 0) {
                return res.status(400).json({ message: `Limit orders are banned for ${symbol} during this time period` });
            }
        }

        // 6. Expiry Rules Check
        const [scripRows] = await db.execute('SELECT expiry_date FROM scrip_data WHERE symbol = ?', [symbol]);
        const [expiryRuleRows] = await db.execute('SELECT * FROM expiry_rules WHERE id = 1');
        const expiryRule = expiryRuleRows[0];
        const scrip = scripRows[0];

        if (expiryRule && scrip && scrip.expiry_date) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const expiryDate = new Date(scrip.expiry_date);
            expiryDate.setHours(0, 0, 0, 0);
            const daysLeft = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));

            // Days before expiry check
            const stopDays = parseInt(expiryRule.days_before_expiry) || 0;
            if (stopDays > 0 && daysLeft <= stopDays && expiryRule.allow_expiring_scrip === 'No') {
                return res.status(400).json({
                    message: `${symbol} expires in ${daysLeft} day(s). New orders are not allowed within ${stopDays} days of expiry.`
                });
            }

            // Away points check for limit orders
            if (order_type !== 'MARKET' && price) {
                const awayPoints = expiryRule.away_points ? JSON.parse(expiryRule.away_points) : {};
                const allowedAway = parseFloat(awayPoints[symbol] || 0);
                if (allowedAway > 0) {
                    const currentPriceNow = mockEngine.getPrice(symbol);
                    const diff = Math.abs(parseFloat(price) - currentPriceNow);
                    if (diff > allowedAway) {
                        return res.status(400).json({
                            message: `Limit order price is too far from market price. Max allowed: ${allowedAway} points away. Current price: ${currentPriceNow}`
                        });
                    }
                }
            }
        }

        // 7. Execution Price Logic
        const currentPrice = mockEngine.getPrice(symbol);
        const executionPrice = price ? parseFloat(price) : (order_type === 'MARKET' ? currentPrice : 0);
        const qtyNum = parseInt(qty, 10);

        if (isNaN(executionPrice) || executionPrice <= 0) {
            return res.status(400).json({ message: 'Invalid price for the selected scrip' });
        }
        if (isNaN(qtyNum) || qtyNum <= 0) {
            return res.status(400).json({ message: 'Quantity must be a positive number' });
        }

        // 8. Basic Margin/Balance Check (Placeholder: 10% margin requirement)
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
                (user_id, symbol, type, order_type, qty, entry_price, exit_price, margin_used, is_pending, market_type, status, trade_ip)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                targetUserId,
                sym,
                type.toUpperCase(),
                order_type,
                qtyNum,
                executionPrice,
                exit_price ? parseFloat(exit_price) : null,
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
            const isPending = req.query.is_pending === 'true' || req.query.is_pending === '1' ? 1 : 0;
            query += ' AND t.is_pending = ?';
            params.push(isPending);
            // Pending orders list should only show active (OPEN) ones, not cancelled
            if (isPending === 1 && !status) {
                query += " AND t.status = 'OPEN'";
            }
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

        // Filter by username
        if (req.query.username) {
            query += ' AND u.username LIKE ?';
            params.push(`%${req.query.username}%`);
        }

        // Filter by scrip (symbol)
        if (req.query.scrip) {
            query += ' AND t.symbol LIKE ?';
            params.push(`%${req.query.scrip}%`);
        }

        // Filter by date range
        if (req.query.fromDate) {
            query += ' AND DATE(t.entry_time) >= ?';
            params.push(req.query.fromDate);
        }
        if (req.query.toDate) {
            query += ' AND DATE(t.entry_time) <= ?';
            params.push(req.query.toDate);
        }

        query += ' ORDER BY t.entry_time DESC';
        const [rows] = await db.execute(query, params);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

/**
 * Get Single Trade by ID
 */
const getTradeById = async (req, res) => {
    try {
        const [rows] = await db.execute(
            `SELECT t.*, u.username, u.full_name 
             FROM trades t 
             JOIN users u ON t.user_id = u.id 
             WHERE t.id = ?`,
            [req.params.id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Trade not found' });
        }

        const trade = rows[0];

        // Access check: Admin sees all, Others see only theirs
        if (req.user.role !== 'SUPERADMIN' && req.user.role !== 'ADMIN' && trade.user_id !== req.user.id) {
            return res.status(403).json({ message: 'Not authorized to view this trade' });
        }

        res.json(trade);
    } catch (err) {
        console.error('Get Trade by ID Error:', err);
        res.status(500).json({ message: 'Server Error' });
    }
};

const getGroupTrades = async (req, res) => {
    try {
        const { id, role } = req.user;
        const { scrip, segment, fromDate, toDate } = req.query;

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

        // Filter by scrip (symbol)
        if (scrip) {
            query += ` AND t.symbol LIKE ?`;
            params.push(`%${scrip}%`);
        }

        // Filter by segment (market type)
        if (segment && segment !== 'All') {
            query += ` AND t.market_type = ?`;
            params.push(segment);
        }

        // Filter by date range
        if (fromDate) {
            query += ` AND DATE(t.entry_time) >= ?`;
            params.push(fromDate);
        }
        if (toDate) {
            query += ` AND DATE(t.entry_time) <= ?`;
            params.push(toDate);
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
 * - Pending orders (is_pending=1): cancelled immediately, margin refunded, no PnL
 * - Open orders: closed at exitPrice or current market price
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

        const marginToRelease = parseFloat(trade.margin_used || 0);

        // Pending orders: cancel with no PnL, just refund margin
        if (trade.is_pending == 1) {
            await db.execute(
                'UPDATE trades SET status = "CANCELLED", exit_price = entry_price, exit_time = NOW(), pnl = 0 WHERE id = ?',
                [req.params.id]
            );
            await db.execute(
                'UPDATE users SET balance = balance + ? WHERE id = ?',
                [marginToRelease, trade.user_id]
            );
            await logAction(req.user.id || trade.user_id, 'CANCEL_TRADE', 'trades', `Cancelled pending order #${trade.id}. Margin refunded: ${marginToRelease}`);
            return res.json({ message: 'Pending order cancelled', pnl: 0, marginReleased: marginToRelease, newBalanceChange: marginToRelease });
        }

        const currentPrice = mockEngine.getPrice(trade.symbol);
        const finalExitPrice = exitPrice || trade.exit_price || currentPrice;

        const pnl = trade.type === 'BUY'
            ? (finalExitPrice - trade.entry_price) * trade.qty
            : (trade.entry_price - finalExitPrice) * trade.qty;

        // Release margin + Add/Subtract PnL
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

        // Clear cache on trade close (Option A - immediate consistency)
        try {
            await invalidateCache(`m2m_${trade.user_id}_TRADER`);
            await invalidateCache(`m2m_${trade.user_id}_SUPERADMIN`);
            console.log(`[Cache] Cleared trade cache for user ${trade.user_id}`);
        } catch (e) {
            console.log(`[Cache] Clear failed but trade closed`);
        }

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

        await db.execute('UPDATE trades SET status = "DELETED", exit_time = NOW() WHERE id = ?', [req.params.id]);

        if (balanceRefund !== 0) {
            await db.execute('UPDATE users SET balance = balance + ? WHERE id = ?', [balanceRefund, trade.user_id]);
        }

        await logAction(req.user.id, 'DELETE_TRADE', 'trades', `Deleted trade #${req.params.id}. Refunded margin: ${marginToRefund}, PnL: ${pnlToRefund}`);

        // Clear cache on trade delete (Option A)
        try {
            await invalidateCache(`m2m_${trade.user_id}_TRADER`);
            await invalidateCache(`m2m_${trade.user_id}_SUPERADMIN`);
        } catch (e) {
            console.log(`[Cache] Clear failed but trade deleted`);
        }

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

/**
 * Modify Pending Order — trader can modify their own pending orders (qty, price)
 */
const modifyPendingOrder = async (req, res) => {
    try {
        const { qty, price } = req.body;
        const tradeId = req.params.id;
        const userId = req.user.id;

        const [trades] = await db.execute('SELECT * FROM trades WHERE id = ?', [tradeId]);
        if (trades.length === 0) return res.status(404).json({ message: 'Trade not found' });

        const trade = trades[0];

        // Trader can only modify their own orders
        if (trade.user_id !== userId) {
            return res.status(403).json({ message: 'Not authorized to modify this order' });
        }

        // Only pending orders can be modified
        if (trade.status !== 'PENDING' && trade.is_pending !== 1) {
            return res.status(400).json({ message: 'Only pending orders can be modified' });
        }

        const updates = [];
        const params = [];

        if (qty !== undefined && qty !== null) {
            updates.push('qty = ?');
            params.push(parseInt(qty));
        }
        if (price !== undefined && price !== null) {
            updates.push('entry_price = ?');
            params.push(parseFloat(price));
        }

        if (updates.length === 0) {
            return res.status(400).json({ message: 'Nothing to update' });
        }

        params.push(tradeId);
        await db.execute(`UPDATE trades SET ${updates.join(', ')} WHERE id = ?`, params);

        res.json({ message: 'Pending order modified successfully' });
    } catch (err) {
        console.error('Modify Pending Order Error:', err);
        res.status(500).json({ message: 'Server Error' });
    }
};

module.exports = { placeOrder, getTrades, getTradeById, getGroupTrades, closeTrade, deleteTrade, updateTrade, restoreTrade, modifyPendingOrder };
