const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const kiteService = require('../utils/kiteService');

const router = express.Router();

// ── In-memory cache ──
const historyCache = {};
const CACHE_TTL = 30000; // 30 seconds

// ── Instrument token lookup cache (rebuilt from instruments cache) ──
let tokenMap = null; // { "NSE:RELIANCE": "738561", ... }
let tokenMapTime = 0;

async function getTokenMap() {
    const now = Date.now();
    if (tokenMap && (now - tokenMapTime) < 6 * 60 * 60 * 1000) return tokenMap; // 6hr cache

    const instruments = await kiteService.getInstruments();
    tokenMap = {};
    for (const inst of instruments) {
        const key = `${inst.exchange}:${inst.tradingsymbol}`;
        tokenMap[key] = inst.instrument_token;
    }
    tokenMapTime = now;
    console.log(`📊 Historical: Token map built with ${Object.keys(tokenMap).length} instruments`);
    return tokenMap;
}

// Valid intervals
const VALID_INTERVALS = ['minute', '3minute', '5minute', '10minute', '15minute', '30minute', '60minute', 'day', 'week', 'month'];

/**
 * GET /api/historical
 *
 * Query params:
 *   symbol   — e.g. NSE:RELIANCE, NFO:NIFTY26APR24000CE, MCX:GOLD26APRFUT
 *   interval — minute, 5minute, 15minute, day, etc.
 *   from     — YYYY-MM-DD or YYYY-MM-DD+HH:MM:SS
 *   to       — YYYY-MM-DD or YYYY-MM-DD+HH:MM:SS
 */
router.get('/', authMiddleware, async (req, res) => {
    try {
        if (!kiteService.isAuthenticated()) {
            return res.status(503).json({ error: 'Kite not connected.', kite_disconnected: true });
        }

        const { symbol, interval, from, to } = req.query;

        // Validate
        if (!symbol) return res.status(400).json({ error: 'symbol is required (e.g. NSE:RELIANCE)' });
        if (!interval || !VALID_INTERVALS.includes(interval)) {
            return res.status(400).json({ error: `interval is required. Valid: ${VALID_INTERVALS.join(', ')}` });
        }
        if (!from || !to) return res.status(400).json({ error: 'from and to dates required (YYYY-MM-DD)' });

        // Cache check
        const cacheKey = `${symbol}_${interval}_${from}_${to}`;
        const now = Date.now();
        if (historyCache[cacheKey] && (now - historyCache[cacheKey].time) < CACHE_TTL) {
            return res.json(historyCache[cacheKey].data);
        }

        // Find instrument token
        const map = await getTokenMap();
        const token = map[symbol];
        if (!token) {
            return res.status(400).json({ error: `Symbol not found: ${symbol}. Use format EXCHANGE:TRADINGSYMBOL` });
        }

        // Fetch from Kite
        const candles = await kiteService.getHistoricalData(token, interval, from, to);

        // Format response
        const data = (candles?.candles || candles || []).map(c => {
            // Kite returns: [timestamp, open, high, low, close, volume]
            if (Array.isArray(c)) {
                return { time: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] || 0 };
            }
            // Already object format
            return { time: c.date || c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 0 };
        });

        const response = {
            status: 'success',
            symbol,
            interval,
            from,
            to,
            count: data.length,
            data,
        };

        // Cache
        historyCache[cacheKey] = { data: response, time: now };

        // Cleanup old cache entries (keep max 50)
        const keys = Object.keys(historyCache);
        if (keys.length > 50) {
            const oldest = keys.sort((a, b) => historyCache[a].time - historyCache[b].time).slice(0, keys.length - 50);
            oldest.forEach(k => delete historyCache[k]);
        }

        res.json(response);
    } catch (err) {
        console.error('Historical data error:', err.message);
        if (err.message?.includes('403') || err.message?.includes('expired')) {
            return res.status(503).json({ error: 'Kite session expired.' });
        }
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
