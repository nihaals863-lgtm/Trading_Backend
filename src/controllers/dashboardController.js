const db = require('../config/db');
const mockEngine = require('../utils/mockEngine');

/**
 * Live M2M Dashboard - Calculates unrealized P/L for all open trades
 * Formula: (Current Price - Entry Price) * Qty
 * Note: Real implementation would fetch 'Current Price' from a live feed/cache.
 */
const getLiveMarket = (req, res) => {
    res.json(mockEngine.getPrices());
};

const getClientLiveM2M = async (req, res) => {
    try {
        const userId = req.user.id;
        const role = req.user.role;

        let query = `
            SELECT t.*, u.username, u.full_name
            FROM trades t
            JOIN users u ON t.user_id = u.id
            WHERE t.status = 'OPEN'
        `;
        let params = [];

        if (role !== 'SUPERADMIN') {
            query += ' AND (u.id = ? OR u.parent_id = ?)';
            params.push(userId, userId);
        }

        const [trades] = await db.execute(query, params);
        
        // Mocking M2M calculation (in production, use real-time market data)
        const m2mData = trades.map(trade => {
            const mockCurrentPrice = parseFloat(trade.entry_price) + (Math.random() * 10 - 5);
            const pnl = (mockCurrentPrice - parseFloat(trade.entry_price)) * trade.qty;
            return {
                ...trade,
                current_price: mockCurrentPrice.toFixed(4),
                live_pnl: pnl.toFixed(4)
            };
        });

        res.json(m2mData);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

const getMarketWatch = async (req, res) => {
    try {
        // In a real app, this would return a list of symbols and their last known prices
        const scrips = [
            { symbol: 'GOLD', name: 'Gold Future', expiry: '2026-04-05' },
            { symbol: 'SILVER', name: 'Silver Future', expiry: '2026-05-05' },
            { symbol: 'CRUDEOIL', name: 'Crude Oil', expiry: '2026-03-20' },
            { symbol: 'ALUMINIUM', name: 'Aluminium', expiry: '2026-03-31' }
        ];
        res.json(scrips);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
};

const getIndices = async (req, res) => {
    res.json([
        { name: 'NIFTY 50', ltp: '22456.20', change: '-101.30', pct: '-0.45' },
        { name: 'BANK NIFTY', ltp: '47890.15', change: '57.45', pct: '+0.12' }
    ]);
};

const getWatchlist = async (req, res) => {
    const prices = mockEngine.getPrices();
    const watchlist = Object.keys(prices).map((symbol, index) => ({
        id: (index + 1).toString(),
        symbol: symbol,
        name: symbol,
        category: symbol.includes('NIFTY') ? 'NSE Futures' : 'MCX Futures',
        ltp: prices[symbol],
        bid: (prices[symbol] - 0.5).toFixed(2),
        ask: (prices[symbol] + 0.5).toFixed(2),
        high: (prices[symbol] + 10).toFixed(2),
        low: (prices[symbol] - 10).toFixed(2),
        change: (Math.random() * 2 - 1).toFixed(2)
    }));
    res.json(watchlist);
};

module.exports = { 
    getLiveMarket, 
    getClientLiveM2M, 
    getMarketWatch,
    getIndices,
    getWatchlist,
    getBrokerM2M: async (req, res) => res.json([])
};
