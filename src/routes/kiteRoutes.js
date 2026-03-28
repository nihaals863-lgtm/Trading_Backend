const express = require('express');
const kiteController = require('../controllers/kiteController');
const kiteTicker = require('../utils/kiteTicker');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

// ── AUTH FLOW ─────────────────────────────────────────

// Step 1: Get login URL (frontend calls this, then redirects user)
router.get('/login', authMiddleware, kiteController.login);

// Step 2: Zerodha redirects here after login (NO auth needed — this is a redirect from Zerodha)
router.get('/callback', kiteController.callback);

// Check connection status
router.get('/status', authMiddleware, kiteController.status);

// Disconnect / logout
router.post('/disconnect', authMiddleware, kiteController.disconnect);

// User Profile & Margins
router.get('/profile', authMiddleware, kiteController.getProfile);
router.get('/margins', authMiddleware, kiteController.getMargins);

// ── MCX Market Data (all symbols at once) ────────────
const MCX_SYMBOLS = [
    'MCX:ALUMINIUM26APRFUT',
    'MCX:COPPER26APRFUT',
    'MCX:CRUDEOIL26APRFUT',
    'MCX:GOLD26APRFUT',
    'MCX:GOLDM26APRFUT',
    'MCX:SILVER26APRFUT',
    'MCX:SILVERM26APRFUT',
    'MCX:ZINC26APRFUT',
    'MCX:LEAD26APRFUT',
    'MCX:NATURALGAS26APRFUT',
    'MCX:NICKEL26APRFUT',
    'MCX:GOLDGUINEA26APRFUT',
    'MCX:GOLDPETAL26APRFUT',
    'MCX:SILVERMIC26APRFUT',
];

router.get('/market', authMiddleware, asyncHandler(async (req, res) => {
    if (!kiteService.isAuthenticated()) {
        return res.status(503).json({ error: 'Kite not connected. Re-login required.', kite_disconnected: true });
    }
    try {
        const quotes = await kiteService.getQuote(MCX_SYMBOLS);
        console.log('MCX Market Data fetched:', Object.keys(quotes).length, 'symbols');

        // Parse response like Java service — extract bid, ask, ohlc, depth
        const parsed = {};
        for (const [symbol, quote] of Object.entries(quotes)) {
            parsed[symbol] = {
                symbol,
                last_price: quote.last_price,
                volume: quote.volume,
                oi: quote.oi,
                change: quote.net_change,
                change_percent: quote.ohlc?.close ? (((quote.last_price - quote.ohlc.close) / quote.ohlc.close) * 100).toFixed(2) : 0,
                ohlc: quote.ohlc || {},
                high: quote.ohlc?.high || 0,
                low: quote.ohlc?.low || 0,
                open: quote.ohlc?.open || 0,
                close: quote.ohlc?.close || 0,
                bid: quote.depth?.buy?.[0]?.price || 0,
                ask: quote.depth?.sell?.[0]?.price || 0,
                bid_qty: quote.depth?.buy?.[0]?.quantity || 0,
                ask_qty: quote.depth?.sell?.[0]?.quantity || 0,
                timestamp: quote.timestamp || null,
                depth: quote.depth || {},
            };
        }

        res.json(parsed);
    } catch (err) {
        if (err.message?.includes('expired') || err.message?.includes('403')) {
            return res.status(503).json({ error: 'Kite token expired. Re-login required.', kite_disconnected: true });
        }
        console.error('MCX Market fetch error:', err.message);
        res.status(500).json({ error: 'Failed to fetch market data: ' + err.message });
    }
}));

// ── KITE DATA APIs ────────────────────────────────────

router.get('/profile', authMiddleware, asyncHandler(async (req, res) => {
    const data = await kiteService.getProfile();
    res.json(data);
}));

router.get('/margins', authMiddleware, asyncHandler(async (req, res) => {
    const data = await kiteService.getMargins();
    res.json(data);
}));

router.get('/holdings', authMiddleware, asyncHandler(async (req, res) => {
    const data = await kiteService.getHoldings();
    res.json(data);
}));

router.get('/positions', authMiddleware, asyncHandler(async (req, res) => {
    const data = await kiteService.getPositions();
    res.json(data);
}));

router.get('/orders', authMiddleware, asyncHandler(async (req, res) => {
    const data = await kiteService.getOrders();
    res.json(data);
}));

router.get('/trades', authMiddleware, asyncHandler(async (req, res) => {
    const data = await kiteService.getTrades();
    res.json(data);
}));

router.get('/quote', authMiddleware, asyncHandler(async (req, res) => {
    const { i } = req.query;
    if (!i) return res.status(400).json({ error: 'Instrument Required' });
    const data = await kiteService.getQuote(i);
    res.json(data);
}));

router.get('/quote/ltp', authMiddleware, asyncHandler(async (req, res) => {
    const { i } = req.query;
    if (!i) return res.status(400).json({ error: 'Instrument Required' });
    const data = await kiteService.getLTP(i);
    res.json(data);
}));

router.get('/instruments', authMiddleware, asyncHandler(async (req, res) => {
    const data = await kiteService.getInstruments();
    res.json(data);
}));

router.get('/instruments/historical/:instrumentToken/:interval', authMiddleware, asyncHandler(async (req, res) => {
    const { instrumentToken, interval } = req.params;
    const { from, to } = req.query;
    const data = await kiteService.getHistoricalData(instrumentToken, interval, from, to);
    res.json(data);
}));

// ── Kite Ticker (WebSocket) routes ──

router.get('/ticker/status', authMiddleware, asyncHandler(async (req, res) => {
    res.json({
        connected: kiteTicker.isConnected(),
        fallbackToMock: kiteTicker.fallbackToMock,
        subscribedCount: kiteTicker.subscribedTokens.length,
    });
}));

router.get('/ticker/prices', authMiddleware, asyncHandler(async (req, res) => {
    res.json(kiteTicker.getPrices());
}));

router.post('/ticker/subscribe', authMiddleware, asyncHandler(async (req, res) => {
    const { tokens, instrumentMap } = req.body;
    if (!tokens || !Array.isArray(tokens)) {
        return res.status(400).json({ error: 'tokens array required' });
    }
    if (instrumentMap) kiteTicker.setInstrumentMap(instrumentMap);
    kiteTicker.subscribe(tokens);
    res.json({ success: true, subscribedCount: kiteTicker.subscribedTokens.length });
}));

router.post('/ticker/unsubscribe', authMiddleware, asyncHandler(async (req, res) => {
    const { tokens } = req.body;
    if (!tokens || !Array.isArray(tokens)) {
        return res.status(400).json({ error: 'tokens array required' });
    }
    kiteTicker.unsubscribe(tokens);
    res.json({ success: true, subscribedCount: kiteTicker.subscribedTokens.length });
}));

router.post('/ticker/reconnect', authMiddleware, asyncHandler(async (req, res) => {
    kiteTicker.disconnect();
    kiteTicker.fallbackToMock = false;
    const started = await kiteTicker.start();
    res.json({ success: started, connected: kiteTicker.isConnected() });
}));

module.exports = router;
