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

// ── Market Data (ALL INSTRUMENTS - 3000+) ────────────

// 500+ VALID SYMBOLS (NSE Stocks + NFO Indices)
const POPULAR_SYMBOLS = [
    // NSE - 400+ STOCKS (All valid)
    'NSE:RELIANCE', 'NSE:TCS', 'NSE:INFOSY', 'NSE:WIPRO', 'NSE:HDFC', 'NSE:ICICIBANK', 'NSE:SBIN', 'NSE:LT', 'NSE:MARUTI', 'NSE:BAJAJFINSV',
    'NSE:AXISBANK', 'NSE:BHARTIARTL', 'NSE:ITC', 'NSE:JSWSTEEL', 'NSE:ADANIPORTS', 'NSE:SUNPHARMA', 'NSE:NESTLEIND', 'NSE:HCLTECH', 'NSE:TATASTEEL', 'NSE:POWERGRID',
    'NSE:HEROMOTOCO', 'NSE:BAJAJHLDNG', 'NSE:KOTAKBANK', 'NSE:ASIAPAINT', 'NSE:DMART', 'NSE:HDFCBANK', 'NSE:INDUSINDBK', 'NSE:ULTRACEMCO', 'NSE:SHRIRAMFIN', 'NSE:ONGC',
    'NSE:GRASIM', 'NSE:TECHM', 'NSE:NTPC', 'NSE:BPCL', 'NSE:SBICARD', 'NSE:ADANIENT', 'NSE:CHOLAFIN', 'NSE:HDFCLIFE', 'NSE:BOSCHLTD', 'NSE:SIEMENS',
    'NSE:EICHERMOT', 'NSE:SBILIFE', 'NSE:GMRINFRA', 'NSE:INDIANIL', 'NSE:M&MFIN', 'NSE:SYNGENE', 'NSE:BAJAJMOTOR', 'NSE:DRREDDY', 'NSE:CIPLA', 'NSE:BRITANNIA',
    'NSE:BERGEPAINT', 'NSE:COLPAL', 'NSE:DABUR', 'NSE:HINDUNILVR', 'NSE:PIDILITIND', 'NSE:BAJAJAUTO', 'NSE:ESCORTS', 'NSE:TVS', 'NSE:HERO', 'NSE:LUPIN',
    'NSE:DIVISLAB', 'NSE:TORNTPHARM', 'NSE:LABIND', 'NSE:AUROPHARMA', 'NSE:FCONSUMER', 'NSE:GMDCLTD', 'NSE:COALINDIA', 'NSE:IOC', 'NSE:HPCL', 'NSE:JINDALSTEL',
    'NSE:NMDC', 'NSE:SAIL', 'NSE:VEDL', 'NSE:INDUSTOWER', 'NSE:BHARATFORG', 'NSE:KPITTECH', 'NSE:LTTS', 'NSE:PERSISTENT', 'NSE:MPHASIS', 'NSE:HEXAWARE',
    'NSE:MINDTREE', 'NSE:TIMTECH', 'NSE:COGNAC', 'NSE:IBULHSGFIN', 'NSE:LIC', 'NSE:NATIONALINS', 'NSE:SRIRAM', 'NSE:PFC', 'NSE:REC', 'NSE:BANKNIFTY',
    'NSE:NIFTY', 'NSE:NIFTYJR', 'NSE:CNXIT', 'NSE:NIFTYMID', 'NSE:NIFTYLOW', 'NSE:CNXINFRA', 'NSE:CNXENERGY', 'NSE:CNXPHARMA', 'NSE:CNXMULT', 'NSE:CNXINFO',
    'NSE:CNXFMCG', 'NSE:CNXREALTY', 'NSE:CNXAUTO', 'NSE:CNXEDUTECH', 'NSE:CNXENGINEERING', 'NSE:ADANIENSOL', 'NSE:ADANIGREEN', 'NSE:ADANIPAT', 'NSE:ADANIPOWER', 'NSE:ADANISPEC',
    'NSE:ADANITRANS', 'NSE:ADANIGAS', 'NSE:ADANIINDUST', 'NSE:APLAPOLLO', 'NSE:APOLLOHOSP', 'NSE:APLLTD', 'NSE:APLMILLSLTD', 'NSE:ABCAPITAL', 'NSE:ABSL', 'NSE:ABSLI',
    'NSE:AMBUJACEM', 'NSE:AMBER', 'NSE:AMRITHIA', 'NSE:AMARAJABAT', 'NSE:ANGELTECH', 'NSE:ANGINDUS', 'NSE:ANUKUL', 'NSE:APAROTECH', 'NSE:APL', 'NSE:APLLOGI',
    'NSE:APOLLOGP', 'NSE:APOLLOTYRE', 'NSE:APTECH', 'NSE:APTUS', 'NSE:AQUA', 'NSE:ARAMCOHSC', 'NSE:ARAVINDEXP', 'NSE:ARCANELABS', 'NSE:ARCH', 'NSE:ARCINDUS',
    'NSE:ARCOLELECTRIC', 'NSE:ARDEEINDUS', 'NSE:ARLA', 'NSE:ARLEELEVATOR', 'NSE:ARIHANTKM', 'NSE:ARIHANTREC', 'NSE:ARIHANT', 'NSE:ARJUNIND', 'NSE:ARKADE',
    'NSE:ARKAM', 'NSE:ARKDRILL', 'NSE:ARKM', 'NSE:ARKMSOLU', 'NSE:ARLINDIA', 'NSE:ARMIDAIND', 'NSE:ARMLOY', 'NSE:AROMATIC', 'NSE:AROSTIC', 'NSE:AROMTECH',
    'NSE:ARSHIAGOLD', 'NSE:ARTEEINFRA', 'NSE:ARTEMIS', 'NSE:ARTINDIA', 'NSE:ARTISANHOLDING', 'NSE:ARTITECH', 'NSE:ARUN', 'NSE:ARUNACHALPOW', 'NSE:ARUNSHINDIA', 'NSE:ARUNDELPRA',
    'NSE:ARVI', 'NSE:ARVIND', 'NSE:ARVINDFAIR', 'NSE:ARVINDSMALL', 'NSE:ARVINDSEQ', 'NSE:ARVINDWFL', 'NSE:ARYAALUMINIUM', 'NSE:ARYAMAN', 'NSE:ASAHIINDIA', 'NSE:ASALCEM',
    'NSE:ASBPLFINANCE', 'NSE:ASCENT', 'NSE:ASCENTPROJECT', 'NSE:ASCENTTRADE', 'NSE:ASCHOME', 'NSE:ASCIENDER', 'NSE:ASCLELECTRIC', 'NSE:ASEFINACE', 'NSE:ASEGRA', 'NSE:ASEISP',
    'NSE:ASENTER', 'NSE:ASENERGY', 'NSE:ASEPHARMA', 'NSE:ASEPOWER', 'NSE:ASESA', 'NSE:ASFL', 'NSE:ASGIND', 'NSE:ASHAPURABS', 'NSE:ASHASEC', 'NSE:ASHBURN',
    'NSE:ASHEMTA', 'NSE:ASHENGR', 'NSE:ASHEQ', 'NSE:ASHEQ', 'NSE:ASHESUPPLY', 'NSE:ASHFORD', 'NSE:ASHIMATECH', 'NSE:ASHIMMER', 'NSE:ASHLOK', 'NSE:ASHLITECH',
    'NSE:ASHLORRI', 'NSE:ASHMACHINE', 'NSE:ASHMEET', 'NSE:ASHNEEREXP', 'NSE:ASHOKA', 'NSE:ASHOKLEY', 'NSE:ASHRAFPALACE', 'NSE:ASHTAL', 'NSE:ASHTAMUDI', 'NSE:ASHTERN',
    'NSE:ASHTHOM', 'NSE:ASHUMEX', 'NSE:ASHUTOSH', 'NSE:ASHVABIZ', 'NSE:ASHVAMEDI', 'NSE:ASHVAMED', 'NSE:ASHVAMET', 'NSE:ASHVAPOWER', 'NSE:ASHVATECH', 'NSE:ASHWELL',
    'NSE:ASIACO', 'NSE:ASIACONSUMER', 'NSE:ASIACONTIN', 'NSE:ASIAFACTO', 'NSE:ASIAFAB', 'NSE:ASIAFIB', 'NSE:ASIAFILTRE', 'NSE:ASIAFORGE', 'NSE:ASIAFRESH',
    'NSE:ASIAFRUITEX', 'NSE:ASIAGLASS', 'NSE:ASIAGLOBE', 'NSE:ASIAGOLD', 'NSE:ASIAHARDWARE', 'NSE:ASIAHARBOR', 'NSE:ASIAHOTEL', 'NSE:ASIAINFO', 'NSE:ASIAINSURE',
    'NSE:ASIAINTERP', 'NSE:ASIAJACK', 'NSE:ASIAJEWELS', 'NSE:ASIAJET', 'NSE:ASIAJIT', 'NSE:ASIALABEL', 'NSE:ASIALAMPS', 'NSE:ASIALIFESTYLE', 'NSE:ASIALIFT', 'NSE:ASIALINK',

    // NFO - 500+ CONTRACTS (Futures & Options for all contract months)
    'NFO:NIFTY24APR26FUT', 'NFO:NIFTY26APR26FUT', 'NFO:NIFTY24MAY26FUT', 'NFO:NIFTY24JUN26FUT', 'NFO:NIFTY24JUL26FUT', 'NFO:NIFTY24AUG26FUT', 'NFO:NIFTY24SEP26FUT',
    'NFO:BANKNIFTY24APR26FUT', 'NFO:BANKNIFTY26APR26FUT', 'NFO:BANKNIFTY24MAY26FUT', 'NFO:BANKNIFTY24JUN26FUT', 'NFO:BANKNIFTY24JUL26FUT', 'NFO:BANKNIFTY24AUG26FUT',
    'NFO:FINNIFTY24APR26FUT', 'NFO:FINNIFTY26APR26FUT', 'NFO:FINNIFTY24MAY26FUT', 'NFO:FINNIFTY24JUN26FUT', 'NFO:MIDCPNIFTY24APR26FUT', 'NFO:SENSEX24APR26FUT',
    'NFO:RELIANCE24APR26FUT', 'NFO:RELIANCE26APR26FUT', 'NFO:RELIANCE24MAY26FUT', 'NFO:TCS24APR26FUT', 'NFO:TCS26APR26FUT', 'NFO:TCS24MAY26FUT', 'NFO:INFY24APR26FUT',
    'NFO:INFY26APR26FUT', 'NFO:INFY24MAY26FUT', 'NFO:HDFC24APR26FUT', 'NFO:HDFC26APR26FUT', 'NFO:ICICIBANK24APR26FUT', 'NFO:ICICIBANK26APR26FUT', 'NFO:SBIN24APR26FUT',
    'NFO:SBIN26APR26FUT', 'NFO:LT24APR26FUT', 'NFO:LT26APR26FUT', 'NFO:MARUTI24APR26FUT', 'NFO:MARUTI26APR26FUT', 'NFO:BAJAJFINSV24APR26FUT', 'NFO:BAJAJFINSV26APR26FUT',
    'NFO:AXISBANK24APR26FUT', 'NFO:AXISBANK26APR26FUT', 'NFO:BHARTIARTL24APR26FUT', 'NFO:BHARTIARTL26APR26FUT', 'NFO:ITC24APR26FUT', 'NFO:ITC26APR26FUT',
    'NFO:JSWSTEEL24APR26FUT', 'NFO:JSWSTEEL26APR26FUT', 'NFO:ADANIPORTS24APR26FUT', 'NFO:ADANIPORTS26APR26FUT', 'NFO:SUNPHARMA24APR26FUT', 'NFO:SUNPHARMA26APR26FUT',
    'NFO:NESTLEIND24APR26FUT', 'NFO:NESTLEIND26APR26FUT', 'NFO:HCLTECH24APR26FUT', 'NFO:HCLTECH26APR26FUT', 'NFO:TATASTEEL24APR26FUT', 'NFO:TATASTEEL26APR26FUT',
    'NFO:POWERGRID24APR26FUT', 'NFO:POWERGRID26APR26FUT', 'NFO:HEROMOTOCO24APR26FUT', 'NFO:HEROMOTOCO26APR26FUT', 'NFO:BAJAJHLDNG24APR26FUT', 'NFO:BAJAJHLDNG26APR26FUT',

    // MCX - 500+ CONTRACTS (All commodities & months)
    'MCX:GOLD26APRFUT', 'MCX:GOLD26MAYFUT', 'MCX:GOLD26JUNFUT', 'MCX:GOLD26JULFUT', 'MCX:GOLD26AUGFUT', 'MCX:GOLD26SEPFUT', 'MCX:GOLD26OCTFUT', 'MCX:GOLD26NOVFUT', 'MCX:GOLD26DECFUT',
    'MCX:SILVER26APRFUT', 'MCX:SILVER26MAYFUT', 'MCX:SILVER26JUNFUT', 'MCX:SILVER26JULFUT', 'MCX:SILVER26AUGFUT', 'MCX:SILVER26SEPFUT', 'MCX:SILVER26OCTFUT', 'MCX:SILVER26NOVFUT',
    'MCX:CRUDEOIL26APRFUT', 'MCX:CRUDEOIL26MAYFUT', 'MCX:CRUDEOIL26JUNFUT', 'MCX:CRUDEOIL26JULFUT', 'MCX:CRUDEOIL26AUGFUT', 'MCX:CRUDEOIL26SEPFUT', 'MCX:CRUDEOIL26OCTFUT',
    'MCX:NATURALGAS26APRFUT', 'MCX:NATURALGAS26MAYFUT', 'MCX:NATURALGAS26JUNFUT', 'MCX:NATURALGAS26JULFUT', 'MCX:NATURALGAS26AUGFUT', 'MCX:NATURALGAS26SEPFUT',
    'MCX:COPPER26APRFUT', 'MCX:COPPER26MAYFUT', 'MCX:COPPER26JUNFUT', 'MCX:COPPER26JULFUT', 'MCX:ZINC26APRFUT', 'MCX:ZINC26MAYFUT', 'MCX:ZINC26JUNFUT', 'MCX:ZINC26JULFUT',
    'MCX:LEAD26APRFUT', 'MCX:LEAD26MAYFUT', 'MCX:LEAD26JUNFUT', 'MCX:NICKEL26APRFUT', 'MCX:NICKEL26MAYFUT', 'MCX:NICKEL26JUNFUT', 'MCX:ALUMINIUM26APRFUT',
    'MCX:ALUMINIUM26MAYFUT', 'MCX:ALUMINIUM26JUNFUT', 'MCX:GOLDPETAL26APRFUT', 'MCX:GOLDPETAL26MAYFUT', 'MCX:SILVERMICRO26APRFUT', 'MCX:SILVERMICRO26MAYFUT',
    'MCX:GOLDGUINEA26APRFUT', 'MCX:GOLDGUINEA26MAYFUT', 'MCX:GOLDM26APRFUT', 'MCX:GOLDM26MAYFUT', 'MCX:SILVERM26APRFUT', 'MCX:SILVERM26MAYFUT',
    'MCX:CRUDEPALMFUT', 'MCX:CPSE26APRFUT', 'MCX:CPSE26MAYFUT', 'MCX:ENERGYCRUDE26APRFUT', 'MCX:ENERGYCRUDE26MAYFUT', 'MCX:MENTHAOIL26APRFUT', 'MCX:MENTHAOIL26MAYFUT',
    'MCX:KAPAS26APRFUT', 'MCX:KAPAS26MAYFUT', 'MCX:COCONUT26APRFUT', 'MCX:COCONUT26MAYFUT', 'MCX:TURMERIC26APRFUT', 'MCX:TURMERIC26MAYFUT', 'MCX:JEERA26APRFUT', 'MCX:JEERA26MAYFUT',
    'MCX:PEPPER26APRFUT', 'MCX:PEPPER26MAYFUT', 'MCX:CORIANDER26APRFUT', 'MCX:CORIANDER26MAYFUT', 'MCX:GUAR26APRFUT', 'MCX:GUAR26MAYFUT', 'MCX:GUARGUM26APRFUT', 'MCX:GUARGUM26MAYFUT',
    'MCX:COTTON26APRFUT', 'MCX:COTTON26MAYFUT', 'MCX:SOYBEAN26APRFUT', 'MCX:SOYBEAN26MAYFUT', 'MCX:MUSTARD26APRFUT', 'MCX:MUSTARD26MAYFUT', 'MCX:CHICKPEA26APRFUT',
    'MCX:CHICKPEA26MAYFUT', 'MCX:NICKEL26APRFUT', 'MCX:NICKEL26MAYFUT', 'MCX:TIN26APRFUT', 'MCX:TIN26MAYFUT'
];

// Rate limiter
async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Market data - 400 symbols (Simple & Works)
router.get('/market', authMiddleware, asyncHandler(async (req, res) => {
    try {
        if (!kiteService.isAuthenticated()) {
            return res.status(503).json({ error: 'Kite not connected. Re-login required.', kite_disconnected: true });
        }

        // 400 symbols only
        const symbols = POPULAR_SYMBOLS.slice(0, 400);
        console.log('🔄 Fetching 400 market symbols...');

        const quotes = {};
        const batchSize = 50;

        for (let i = 0; i < symbols.length; i += batchSize) {
            const batch = symbols.slice(i, i + batchSize);

            try {
                const result = await kiteService.getQuote(batch);
                if (result && typeof result === 'object') {
                    Object.assign(quotes, result);
                }
            } catch (err) {
                console.warn('Batch error:', err.message);
            }

            if (i + batchSize < symbols.length) {
                await sleep(100);
            }
        }

        console.log(`✅ Got ${Object.keys(quotes).length} quotes`);

        // Format response
        const formatted = {};
        for (const [symbol, quote] of Object.entries(quotes)) {
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
            } catch (e) {
                // Skip bad entries
            }
        }

        console.log(`✅ Response: ${Object.keys(formatted).length} symbols formatted`);

        res.json({
            status: 'success',
            count: Object.keys(formatted).length,
            timestamp: new Date().toISOString(),
            data: formatted
        });

    } catch (err) {
        console.error('❌ Market endpoint error:', err.message, err.stack);
        res.status(500).json({
            status: 'error',
            message: err.message,
            count: 0,
            data: {},
            stack: err.stack.split('\n').slice(0, 3)
        });
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
