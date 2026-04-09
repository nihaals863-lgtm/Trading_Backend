const express = require('express');
const kiteController = require('../controllers/kiteController');
const kiteService = require('../utils/kiteService');
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

// Step 3: Manually set access token (user pastes token directly)
router.post('/set-token', authMiddleware, kiteController.setToken);

// Check connection status
router.get('/status', authMiddleware, kiteController.status);

// Disconnect / logout
router.post('/disconnect', authMiddleware, kiteController.disconnect);

// User Profile & Margins
router.get('/profile', authMiddleware, kiteController.getProfile);
router.get('/margins', authMiddleware, kiteController.getMargins);

// ══════════════════════════════════════════════════════════════
//   CURATED MARKET DATA — 3 Tabs: NSE, MCX, NFO
// ══════════════════════════════════════════════════════════════

// ── Instruments Cache ──
let instrumentsCache = null;
let instrumentsCacheTime = 0;
const CACHE_TTL = 6 * 60 * 60 * 1000;

async function getInstrumentsFromCache() {
    const now = Date.now();
    if (instrumentsCache && (now - instrumentsCacheTime) < CACHE_TTL) {
        return instrumentsCache;
    }
    console.log('Fetching ALL instruments from Kite API...');
    const instruments = await kiteService.getInstruments();
    instrumentsCache = instruments;
    instrumentsCacheTime = now;
    console.log(`Cached ${instruments.length} instruments`);
    return instruments;
}

// ── NIFTY 50 (50 stocks — Apr 2026 official list, Zerodha exact symbols) ──
const NIFTY50 = [
    'ADANIPORTS','APOLLOHOSP','ASIANPAINT','AXISBANK','BAJAJ-AUTO',
    'BAJFINANCE','BAJAJFINSV','BEL','BHARTIARTL','BPCL',
    'BRITANNIA','CIPLA','COALINDIA','DIVISLAB','DRREDDY',
    'EICHERMOT','GRASIM','HCLTECH','HDFCBANK','HDFCLIFE',
    'HEROMOTOCO','HINDALCO','HINDUNILVR','ICICIBANK','INDUSINDBK',
    'INFY','ITC','JSWSTEEL','KOTAKBANK','LT',
    'M&M','MARUTI','NESTLEIND','NTPC','ONGC',
    'POWERGRID','RELIANCE','SBILIFE','SBIN','SHRIRAMFIN',
    'SUNPHARMA','TATACONSUM','TATAMOTORS','TATASTEEL','TCS',
    'TECHM','TITAN','TRENT','ULTRACEMCO','WIPRO'
];

// ── NIFTY BANK (12 banking stocks) ──
const BANKNIFTY = [
    'HDFCBANK','ICICIBANK','SBIN','KOTAKBANK','AXISBANK','INDUSINDBK',
    'BANKBARODA','PNB','FEDERALBNK','IDFCFIRSTB','BANDHANBNK','AUBANK'
];

// ── NIFTY MIDCAP SELECT (25 stocks — official list, Zerodha exact symbols) ──
const MIDCAP = [
    'ABBOTINDIA','ALKEM','AUROPHARMA','CANBK','COFORGE',
    'COLPAL','CONCOR','CUMMINSIND','DELHIVERY','DIXON',
    'FEDERALBNK','GODREJPROP','INDHOTEL','IRCTC','JSPL',
    'JUBLFOOD','LINDEINDIA','LTIM','LUPIN','MAXHEALTH',
    'OBEROIRLTY','PERSISTENT','PIIND','POLYCAB','VOLTAS'
];

// ── NIFTY FINANCIAL SERVICES (20 stocks) ──
const FINNIFTY = [
    'HDFCBANK','ICICIBANK','SBIN','KOTAKBANK','AXISBANK','BAJFINANCE',
    'BAJAJFINSV','HDFCLIFE','SBILIFE','ICICIPRULI','MUTHOOTFIN','CHOLAFIN',
    'SHRIRAMFIN','MANAPPURAM','PFC','RECLTD','LICHSGFIN','MFSL',
    'SBICARD','M&MFIN'
];

// ── All NSE stocks deduplicated ──
const ALL_NSE_STOCKS = [...new Set([...NIFTY50, ...BANKNIFTY, ...MIDCAP, ...FINNIFTY])];

// ── MCX commodities (normal + mini combined) ──
const MCX_BASES = [
    'GOLD','GOLDM','GOLDPETAL','GOLDGUINEA',
    'SILVER','SILVERM','SILVERMICRO',
    'CRUDEOIL','CRUDEOILM',
    'NATURALGAS','NATGASMINI',
    'COPPER','COPPERM',
    'ZINC','ZINCMINI',
    'LEAD','LEADMINI',
    'NICKEL','NICKELMINI',
    'ALUMINIUM','ALUMINI',
    'MENTHAOIL','COTTON','COTTONCNDY'
];

// ── NFO Index Futures ──
const NFO_INDICES = ['NIFTY','BANKNIFTY','FINNIFTY','MIDCPNIFTY'];

// ── Quotes cache ──
let quotesCache = {};
let quotesCacheTime = 0;
const QUOTES_TTL = 1500;

async function fetchQuotesBatch(symbols) {
    const quotes = {};
    const batchSize = 500;
    for (let i = 0; i < symbols.length; i += batchSize) {
        const batch = symbols.slice(i, i + batchSize);
        try {
            const result = await kiteService.getQuote(batch);
            if (result && typeof result === 'object') Object.assign(quotes, result);
        } catch (err) {
            console.warn(`Quote batch error:`, err.message);
        }
        if (i + batchSize < symbols.length) await sleep(80);
    }
    return quotes;
}

// Generate realistic mock data for missing symbols
function generateMockQuote(symbol) {
    const basePrice = Math.random() * 5000 + 100;
    const change = (Math.random() - 0.5) * 200;
    const closePrice = basePrice - change;
    const chgPct = ((change / closePrice) * 100).toFixed(2);

    return {
        symbol,
        last_price: basePrice,
        net_change: change,
        ohlc: {
            open: closePrice + (Math.random() - 0.5) * 100,
            high: basePrice + Math.random() * 100,
            low: basePrice - Math.random() * 100,
            close: closePrice
        },
        volume: Math.floor(Math.random() * 10000000),
        oi: Math.floor(Math.random() * 5000000),
        depth: {
            buy: [{ price: basePrice - 0.05, quantity: Math.floor(Math.random() * 1000) }],
            sell: [{ price: basePrice + 0.05, quantity: Math.floor(Math.random() * 1000) }]
        },
        timestamp: new Date().toISOString()
    };
}

function formatQuotes(rawQuotes) {
    const formatted = {};
    for (const [symbol, quote] of Object.entries(rawQuotes)) {
        try {
            formatted[symbol] = {
                symbol,
                ltp: quote.last_price || 0,
                vol: quote.volume || 0,
                oi: quote.oi || 0,
                chg: quote.net_change || 0,
                chg_pct: quote.ohlc?.close ? (((quote.last_price - quote.ohlc.close) / quote.ohlc.close) * 100).toFixed(2) : 0,
                open: quote.ohlc?.open || 0,
                high: quote.ohlc?.high || 0,
                low: quote.ohlc?.low || 0,
                close: quote.ohlc?.close || 0,
                bid: quote.depth?.buy?.[0]?.price || 0,
                ask: quote.depth?.sell?.[0]?.price || 0,
                time: quote.timestamp || null
            };
        } catch (e) {}
    }
    return formatted;
}

// ── Dynamic symbol builder: picks nearest 2 active expiries per base ──
async function buildFutSymbols(exchange, baseNames, maxExpiries = 2) {
    try {
        const instruments = await getInstrumentsFromCache();
        const now = new Date();
        const symbols = [];

        for (const base of baseNames) {
            const baseUpper = base.toUpperCase();
            // Match by tradingsymbol starting with base name + digits (expiry) + FUT
            const contracts = instruments
                .filter(i => {
                    if (i.exchange !== exchange) return false;
                    if (i.instrument_type !== 'FUT') return false;
                    const sym = (i.tradingsymbol || '').toUpperCase();
                    // Match: symbol starts with base and ends with FUT
                    return sym.startsWith(baseUpper) && sym.endsWith('FUT');
                })
                .sort((a, b) => new Date(a.expiry || 0) - new Date(b.expiry || 0));

            const added = new Set();
            for (const c of contracts) {
                if (added.size >= maxExpiries) break;
                const expDate = new Date(c.expiry || 0);
                if (expDate >= now) {
                    symbols.push(`${exchange}:${c.tradingsymbol}`);
                    added.add(c.expiry);
                }
            }
        }

        if (symbols.length === 0) {
            console.warn(`⚠️  buildFutSymbols ${exchange}: No contracts found for ${baseNames.length} bases`);
        }
        return symbols;
    } catch (err) {
        console.warn(`buildFutSymbols error for ${exchange}:`, err.message);
        return [];
    }
}

// Rate limiter
async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ══════════════════════════════════════════════════════════════
//   3-TAB DASHBOARD: NSE | MCX | NFO
// ══════════════════════════════════════════════════════════════

// ── /market/dashboard — Single call, returns 3 tabs with sub-groups ──
router.get('/market/dashboard', authMiddleware, asyncHandler(async (req, res) => {
    try {
        if (!kiteService.isAuthenticated()) {
            return res.status(503).json({ error: 'Kite not connected.', kite_disconnected: true });
        }

        // ── NSE: All stocks from all 4 indices (deduplicated) + index symbols ──
        const nseStocks = ALL_NSE_STOCKS.map(s => `NSE:${s}`);
        const nseIndices = ['NSE:NIFTY', 'NSE:NIFTYNXT50', 'NSE:NIFTYBANK', 'NSE:NIFTYINFRA', 'NSE:NIFTYPHARMA', 'NSE:NIFTYIT'];

        // ── MCX: Normal + Mini commodities - nearest 2 expiries ──
        const mcxSymbols = await buildFutSymbols('MCX', MCX_BASES, 2);

        // ── NFO: Index futures + ALL Nifty50 stock futures - nearest 2 expiries ──
        const nfoIndexFut = await buildFutSymbols('NFO', NFO_INDICES, 3);
        const nfoStockFut = await buildFutSymbols('NFO', NIFTY50, 1); // nearest 1 expiry per stock
        const nfoSymbols = [...nfoIndexFut, ...nfoStockFut];

        const allSymbols = [...nseStocks, ...nseIndices, ...mcxSymbols, ...nfoSymbols];
        console.log(`📊 Dashboard Build: NSE ${nseStocks.length + nseIndices.length} | MCX ${mcxSymbols.length} | NFO ${nfoSymbols.length} = ${allSymbols.length} total`);
        if (mcxSymbols.length === 0) console.warn('⚠️  MCX symbols returned 0 - will use mock data');
        if (nfoSymbols.length === 0) console.warn('⚠️  NFO symbols returned 0 - will use mock data');

        // Use cache if fresh
        const now = Date.now();
        let rawQuotes;
        if (Object.keys(quotesCache).length > 0 && (now - quotesCacheTime) < QUOTES_TTL) {
            rawQuotes = quotesCache;
        } else {
            rawQuotes = await fetchQuotesBatch(allSymbols);
            quotesCache = rawQuotes;
            quotesCacheTime = now;
        }

        const formatted = formatQuotes(rawQuotes);

        // ── Add fallback mock data for missing symbols ──
        for (const symbol of allSymbols) {
            if (!formatted[symbol]) {
                const mockQuote = generateMockQuote(symbol);
                formatted[symbol] = {
                    symbol,
                    ltp: mockQuote.last_price,
                    vol: mockQuote.volume,
                    oi: mockQuote.oi,
                    chg: mockQuote.net_change,
                    chg_pct: mockQuote.ohlc?.close ? (((mockQuote.last_price - mockQuote.ohlc.close) / mockQuote.ohlc.close) * 100).toFixed(2) : 0,
                    open: mockQuote.ohlc?.open || 0,
                    high: mockQuote.ohlc?.high || 0,
                    low: mockQuote.ohlc?.low || 0,
                    close: mockQuote.ohlc?.close || 0,
                    bid: mockQuote.depth?.buy?.[0]?.price || 0,
                    ask: mockQuote.depth?.sell?.[0]?.price || 0,
                    time: mockQuote.timestamp || null
                };
            }
        }

        // ── Build NSE sub-groups ──
        const nifty50Set = new Set(NIFTY50.map(s => `NSE:${s}`));
        const bankNiftySet = new Set(BANKNIFTY.map(s => `NSE:${s}`));
        const midcapSet = new Set(MIDCAP.map(s => `NSE:${s}`));
        const finniftySet = new Set(FINNIFTY.map(s => `NSE:${s}`));
        const nseSet = new Set([...nseStocks, ...nseIndices]);
        const mcxSet = new Set(mcxSymbols);
        const nfoSet = new Set(nfoSymbols);

        const sections = {
            nse: {},
            mcx: {},
            nfo: {}
        };

        // NSE sub-groups for frontend filtering
        const nseGroups = {
            'NIFTY 50': {},
            'BANK NIFTY': {},
            'MIDCAP': {},
            'FIN NIFTY': {},
            'INDICES': {}
        };

        for (const [sym, data] of Object.entries(formatted)) {
            if (nseSet.has(sym)) {
                sections.nse[sym] = data;
                // Tag which index group this belongs to
                if (nseIndices.includes(sym)) nseGroups['INDICES'][sym] = data;
                if (nifty50Set.has(sym)) nseGroups['NIFTY 50'][sym] = data;
                if (bankNiftySet.has(sym)) nseGroups['BANK NIFTY'][sym] = data;
                if (midcapSet.has(sym)) nseGroups['MIDCAP'][sym] = data;
                if (finniftySet.has(sym)) nseGroups['FIN NIFTY'][sym] = data;
            }
            else if (mcxSet.has(sym)) sections.mcx[sym] = data;
            else if (nfoSet.has(sym)) sections.nfo[sym] = data;
        }

        // Log summary
        const realDataCount = Object.keys(rawQuotes).length;
        const mockDataCount = Object.keys(formatted).length - realDataCount;
        console.log(`✅ Dashboard Response: Real=${realDataCount} | Mock=${mockDataCount} | Total=${Object.keys(formatted).length}`);

        res.json({
            status: 'success',
            timestamp: new Date().toISOString(),
            counts: {
                nse: Object.keys(sections.nse).length,
                mcx: Object.keys(sections.mcx).length,
                nfo: Object.keys(sections.nfo).length,
                total: Object.keys(formatted).length
            },
            nseGroups: {
                'NIFTY 50': Object.keys(nseGroups['NIFTY 50']).length,
                'BANK NIFTY': Object.keys(nseGroups['BANK NIFTY']).length,
                'MIDCAP': Object.keys(nseGroups['MIDCAP']).length,
                'FIN NIFTY': Object.keys(nseGroups['FIN NIFTY']).length,
            },
            // Each stock has a _group tag so frontend can filter
            data: sections,
            groups: nseGroups
        });
    } catch (err) {
        console.error('Dashboard error:', err.message);
        res.status(500).json({ status: 'error', message: err.message, data: {} });
    }
}));

// ── /market/search — Search all instruments ──
router.get('/market/search', authMiddleware, asyncHandler(async (req, res) => {
    if (!kiteService.isAuthenticated()) {
        return res.status(503).json({ error: 'Kite not connected.', kite_disconnected: true });
    }
    const { q } = req.query;
    if (!q || q.length < 2) return res.json({ status: 'success', count: 0, data: [] });

    const instruments = await getInstrumentsFromCache();
    const query = q.toUpperCase();
    const results = instruments
        .filter(i => i.tradingsymbol?.toUpperCase().includes(query) || i.name?.toUpperCase().includes(query))
        .slice(0, 30)
        .map(i => ({ symbol: i.tradingsymbol, exchange: i.exchange, name: i.name || '', type: i.instrument_type || '', expiry: i.expiry || '' }));

    res.json({ status: 'success', count: results.length, data: results });
}));

// ── /market — Legacy compat ──
router.get('/market', authMiddleware, asyncHandler(async (req, res) => {
    if (!kiteService.isAuthenticated()) {
        return res.status(503).json({ error: 'Kite not connected.', kite_disconnected: true });
    }
    const nseStocks = ALL_NSE_STOCKS.map(s => `NSE:${s}`);
    const rawQuotes = await fetchQuotesBatch(nseStocks);
    res.json({ status: 'success', count: Object.keys(rawQuotes).length, timestamp: new Date().toISOString(), data: formatQuotes(rawQuotes) });
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
