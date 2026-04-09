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

// ── Index-wise maps (for frontend sub-tabs) ──
const NSE_INDEX_MAP = {
    'NIFTY 50': NIFTY50,
    'BANK NIFTY': BANKNIFTY,
    'MIDCAP SELECT': MIDCAP,
    'FIN NIFTY': FINNIFTY
};

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
            // Also match by name field as fallback
            const contracts = instruments
                .filter(i => {
                    if (i.exchange !== exchange) return false;
                    if (i.instrument_type !== 'FUT') return false;
                    const sym = (i.tradingsymbol || '').toUpperCase();
                    const nm = (i.name || '').toUpperCase();
                    // Exact match: symbol starts with base and rest is expiry+FUT
                    return sym.startsWith(baseUpper) && sym.endsWith('FUT') && /\d/.test(sym.replace(baseUpper, '').charAt(0))
                        || nm === baseUpper;
                })
                .sort((a, b) => new Date(a.expiry) - new Date(b.expiry));

            const added = new Set();
            for (const c of contracts) {
                if (added.size >= maxExpiries) break;
                if (new Date(c.expiry) >= now) {
                    symbols.push(`${exchange}:${c.tradingsymbol}`);
                    added.add(c.expiry);
                }
            }
        }
        return symbols;
    } catch (err) {
        console.warn(`buildFutSymbols error for ${exchange}:`, err.message);
        return [];
    }
}

// Legacy fallback
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
    'NSE:ADANITRANS', 'NSE:ADANIGAS', 'NSE:APLAPOLLO', 'NSE:APOLLOHOSP', 'NSE:ABCAPITAL', 'NSE:AMBUJACEM', 'NSE:AMBER', 'NSE:AMARAJABAT',
    'NSE:APOLLOTYRE', 'NSE:ASHOKLEY', 'NSE:ARVIND', 'NSE:ASAHIINDIA',
    'NSE:ASTRAL', 'NSE:ATUL', 'NSE:AUBANK', 'NSE:AUROPHARMA', 'NSE:BALKRISIND', 'NSE:BANDHANBNK', 'NSE:BANKBARODA', 'NSE:BATAINDIA',
    'NSE:BEL', 'NSE:BHEL', 'NSE:BIOCON', 'NSE:CANBK', 'NSE:CANFINHOME', 'NSE:CHAMBLFERT', 'NSE:COFORGE', 'NSE:CONCOR',
    'NSE:COROMANDEL', 'NSE:CROMPTON', 'NSE:CUB', 'NSE:CUMMINSIND', 'NSE:DLF', 'NSE:DEEPAKNTR', 'NSE:DELTACORP', 'NSE:DELHIVERY',
    'NSE:FEDERALBNK', 'NSE:FORTIS', 'NSE:GAIL', 'NSE:GLENMARK', 'NSE:GMRINFRA', 'NSE:GNFC', 'NSE:GODREJCP', 'NSE:GODREJPROP',
    'NSE:GRANULES', 'NSE:GSPL', 'NSE:GUJGASLTD', 'NSE:HAL', 'NSE:HAVELLS', 'NSE:HINDALCO', 'NSE:HINDCOPPER', 'NSE:HINDPETRO',
    'NSE:HONAUT', 'NSE:IBREALEST', 'NSE:ICICIPRULI', 'NSE:IDEA', 'NSE:IDFCFIRSTB', 'NSE:IGL', 'NSE:INDIANB', 'NSE:INDHOTEL',
    'NSE:INDIGO', 'NSE:IRCTC', 'NSE:IEX', 'NSE:ISEC', 'NSE:JKCEMENT', 'NSE:JUBLFOOD', 'NSE:LALPATHLAB', 'NSE:LAURUSLABS',
    'NSE:LICHSGFIN', 'NSE:LTIM', 'NSE:LTF', 'NSE:M&M', 'NSE:M&MFIN', 'NSE:MANAPPURAM', 'NSE:MARICO', 'NSE:MAXHEALTH',
    'NSE:MCX', 'NSE:METROPOLIS', 'NSE:MFSL', 'NSE:MGL', 'NSE:MOTHERSON', 'NSE:MUTHOOTFIN', 'NSE:NAM-INDIA', 'NSE:NATIONALUM',
    'NSE:NAUKRI', 'NSE:NAVINFLUOR', 'NSE:NBCC', 'NSE:NCC', 'NSE:NIACL', 'NSE:NHPC', 'NSE:OBEROIRLTY', 'NSE:OFSS',
    'NSE:OIL', 'NSE:PAGEIND', 'NSE:PEL', 'NSE:PETRONET', 'NSE:PNB', 'NSE:POLYCAB', 'NSE:POONAWALLA', 'NSE:PRESTIGE',
    'NSE:PVRINOX', 'NSE:RAMCOCEM', 'NSE:RBLBANK', 'NSE:RECLTD', 'NSE:RELAXO', 'NSE:SAIL', 'NSE:SBICARD', 'NSE:SJVN',
    'NSE:SRF', 'NSE:STAR', 'NSE:SUMICHEM', 'NSE:SUNDARMFIN', 'NSE:SUNTV', 'NSE:SUPREMEIND', 'NSE:SYNGENE', 'NSE:TATACHEM',
    'NSE:TATACOMM', 'NSE:TATACONSUM', 'NSE:TATAELXSI', 'NSE:TATAMOTORS', 'NSE:TATAPOWER', 'NSE:TORNTPHARM', 'NSE:TRENT', 'NSE:TRIDENT',
    'NSE:TVSMOTOR', 'NSE:UBL', 'NSE:UNIONBANK', 'NSE:UPL', 'NSE:VOLTAS', 'NSE:WHIRLPOOL', 'NSE:ZEEL', 'NSE:ZOMATO', 'NSE:ZYDUSLIFE',

    // NFO - Index & Stock Futures (correct Zerodha format: SYMBOL+YYMMMFUT)
    'NFO:NIFTY26APRFUT', 'NFO:NIFTY26MAYFUT', 'NFO:NIFTY26JUNFUT', 'NFO:NIFTY26JULFUT', 'NFO:NIFTY26AUGFUT', 'NFO:NIFTY26SEPFUT',
    'NFO:BANKNIFTY26APRFUT', 'NFO:BANKNIFTY26MAYFUT', 'NFO:BANKNIFTY26JUNFUT', 'NFO:BANKNIFTY26JULFUT', 'NFO:BANKNIFTY26AUGFUT', 'NFO:BANKNIFTY26SEPFUT',
    'NFO:FINNIFTY26APRFUT', 'NFO:FINNIFTY26MAYFUT', 'NFO:FINNIFTY26JUNFUT', 'NFO:MIDCPNIFTY26APRFUT', 'NFO:MIDCPNIFTY26MAYFUT',
    'NFO:RELIANCE26APRFUT', 'NFO:RELIANCE26MAYFUT', 'NFO:RELIANCE26JUNFUT',
    'NFO:TCS26APRFUT', 'NFO:TCS26MAYFUT', 'NFO:TCS26JUNFUT',
    'NFO:INFY26APRFUT', 'NFO:INFY26MAYFUT', 'NFO:INFY26JUNFUT',
    'NFO:HDFCBANK26APRFUT', 'NFO:HDFCBANK26MAYFUT', 'NFO:HDFCBANK26JUNFUT',
    'NFO:ICICIBANK26APRFUT', 'NFO:ICICIBANK26MAYFUT', 'NFO:ICICIBANK26JUNFUT',
    'NFO:SBIN26APRFUT', 'NFO:SBIN26MAYFUT', 'NFO:SBIN26JUNFUT',
    'NFO:LT26APRFUT', 'NFO:LT26MAYFUT', 'NFO:MARUTI26APRFUT', 'NFO:MARUTI26MAYFUT',
    'NFO:AXISBANK26APRFUT', 'NFO:AXISBANK26MAYFUT', 'NFO:KOTAKBANK26APRFUT', 'NFO:KOTAKBANK26MAYFUT',
    'NFO:BHARTIARTL26APRFUT', 'NFO:BHARTIARTL26MAYFUT', 'NFO:ITC26APRFUT', 'NFO:ITC26MAYFUT',
    'NFO:TATASTEEL26APRFUT', 'NFO:TATASTEEL26MAYFUT', 'NFO:JSWSTEEL26APRFUT', 'NFO:JSWSTEEL26MAYFUT',
    'NFO:ADANIPORTS26APRFUT', 'NFO:ADANIPORTS26MAYFUT', 'NFO:SUNPHARMA26APRFUT', 'NFO:SUNPHARMA26MAYFUT',
    'NFO:HCLTECH26APRFUT', 'NFO:HCLTECH26MAYFUT', 'NFO:WIPRO26APRFUT', 'NFO:WIPRO26MAYFUT',
    'NFO:TECHM26APRFUT', 'NFO:TECHM26MAYFUT', 'NFO:POWERGRID26APRFUT', 'NFO:POWERGRID26MAYFUT',
    'NFO:NTPC26APRFUT', 'NFO:NTPC26MAYFUT', 'NFO:ONGC26APRFUT', 'NFO:ONGC26MAYFUT',
    'NFO:COALINDIA26APRFUT', 'NFO:COALINDIA26MAYFUT', 'NFO:BAJFINANCE26APRFUT', 'NFO:BAJFINANCE26MAYFUT',
    'NFO:BAJAJFINSV26APRFUT', 'NFO:BAJAJFINSV26MAYFUT', 'NFO:HEROMOTOCO26APRFUT', 'NFO:HEROMOTOCO26MAYFUT',
    'NFO:EICHERMOT26APRFUT', 'NFO:EICHERMOT26MAYFUT', 'NFO:M&M26APRFUT', 'NFO:M&M26MAYFUT',
    'NFO:TATAMOTORS26APRFUT', 'NFO:TATAMOTORS26MAYFUT', 'NFO:DRREDDY26APRFUT', 'NFO:DRREDDY26MAYFUT',
    'NFO:CIPLA26APRFUT', 'NFO:CIPLA26MAYFUT', 'NFO:DIVISLAB26APRFUT', 'NFO:DIVISLAB26MAYFUT',
    'NFO:BRITANNIA26APRFUT', 'NFO:BRITANNIA26MAYFUT', 'NFO:HINDUNILVR26APRFUT', 'NFO:HINDUNILVR26MAYFUT',
    'NFO:NESTLEIND26APRFUT', 'NFO:NESTLEIND26MAYFUT', 'NFO:ULTRACEMCO26APRFUT', 'NFO:ULTRACEMCO26MAYFUT',
    'NFO:GRASIM26APRFUT', 'NFO:GRASIM26MAYFUT', 'NFO:SHRIRAMFIN26APRFUT', 'NFO:SHRIRAMFIN26MAYFUT',
    'NFO:APOLLOHOSP26APRFUT', 'NFO:APOLLOHOSP26MAYFUT', 'NFO:BPCL26APRFUT', 'NFO:BPCL26MAYFUT',
    'NFO:INDUSINDBK26APRFUT', 'NFO:INDUSINDBK26MAYFUT', 'NFO:VEDL26APRFUT', 'NFO:VEDL26MAYFUT',
    'NFO:TATACONSUM26APRFUT', 'NFO:TATACONSUM26MAYFUT', 'NFO:ADANIENT26APRFUT', 'NFO:ADANIENT26MAYFUT',
    'NFO:SBILIFE26APRFUT', 'NFO:SBILIFE26MAYFUT', 'NFO:HDFCLIFE26APRFUT', 'NFO:HDFCLIFE26MAYFUT',
    'NFO:PIDILITIND26APRFUT', 'NFO:PIDILITIND26MAYFUT', 'NFO:AMBUJACEM26APRFUT', 'NFO:AMBUJACEM26MAYFUT',

    // MCX - Commodities Futures (all sub-types & months)
    'MCX:GOLD26APRFUT', 'MCX:GOLD26MAYFUT', 'MCX:GOLD26JUNFUT', 'MCX:GOLD26JULFUT', 'MCX:GOLD26AUGFUT', 'MCX:GOLD26SEPFUT', 'MCX:GOLD26OCTFUT', 'MCX:GOLD26NOVFUT', 'MCX:GOLD26DECFUT',
    'MCX:GOLDM26APRFUT', 'MCX:GOLDM26MAYFUT', 'MCX:GOLDM26JUNFUT', 'MCX:GOLDM26JULFUT', 'MCX:GOLDM26AUGFUT', 'MCX:GOLDM26SEPFUT',
    'MCX:GOLDPETAL26APRFUT', 'MCX:GOLDPETAL26MAYFUT', 'MCX:GOLDPETAL26JUNFUT', 'MCX:GOLDPETAL26JULFUT',
    'MCX:GOLDGUINEA26APRFUT', 'MCX:GOLDGUINEA26MAYFUT', 'MCX:GOLDGUINEA26JUNFUT',
    'MCX:SILVER26APRFUT', 'MCX:SILVER26MAYFUT', 'MCX:SILVER26JUNFUT', 'MCX:SILVER26JULFUT', 'MCX:SILVER26AUGFUT', 'MCX:SILVER26SEPFUT', 'MCX:SILVER26OCTFUT', 'MCX:SILVER26NOVFUT',
    'MCX:SILVERM26APRFUT', 'MCX:SILVERM26MAYFUT', 'MCX:SILVERM26JUNFUT', 'MCX:SILVERM26JULFUT', 'MCX:SILVERM26AUGFUT',
    'MCX:SILVERMICRO26APRFUT', 'MCX:SILVERMICRO26MAYFUT', 'MCX:SILVERMICRO26JUNFUT', 'MCX:SILVERMICRO26JULFUT',
    'MCX:CRUDEOIL26APRFUT', 'MCX:CRUDEOIL26MAYFUT', 'MCX:CRUDEOIL26JUNFUT', 'MCX:CRUDEOIL26JULFUT', 'MCX:CRUDEOIL26AUGFUT', 'MCX:CRUDEOIL26SEPFUT', 'MCX:CRUDEOIL26OCTFUT', 'MCX:CRUDEOIL26NOVFUT', 'MCX:CRUDEOIL26DECFUT',
    'MCX:CRUDEOILM26APRFUT', 'MCX:CRUDEOILM26MAYFUT', 'MCX:CRUDEOILM26JUNFUT', 'MCX:CRUDEOILM26JULFUT',
    'MCX:NATURALGAS26APRFUT', 'MCX:NATURALGAS26MAYFUT', 'MCX:NATURALGAS26JUNFUT', 'MCX:NATURALGAS26JULFUT', 'MCX:NATURALGAS26AUGFUT', 'MCX:NATURALGAS26SEPFUT', 'MCX:NATURALGAS26OCTFUT',
    'MCX:NATGASMINI26APRFUT', 'MCX:NATGASMINI26MAYFUT', 'MCX:NATGASMINI26JUNFUT',
    'MCX:COPPER26APRFUT', 'MCX:COPPER26MAYFUT', 'MCX:COPPER26JUNFUT', 'MCX:COPPER26JULFUT', 'MCX:COPPER26AUGFUT',
    'MCX:COPPERM26APRFUT', 'MCX:COPPERM26MAYFUT', 'MCX:COPPERM26JUNFUT',
    'MCX:ZINC26APRFUT', 'MCX:ZINC26MAYFUT', 'MCX:ZINC26JUNFUT', 'MCX:ZINC26JULFUT',
    'MCX:ZINCMINI26APRFUT', 'MCX:ZINCMINI26MAYFUT', 'MCX:ZINCMINI26JUNFUT',
    'MCX:LEAD26APRFUT', 'MCX:LEAD26MAYFUT', 'MCX:LEAD26JUNFUT',
    'MCX:LEADMINI26APRFUT', 'MCX:LEADMINI26MAYFUT', 'MCX:LEADMINI26JUNFUT',
    'MCX:NICKEL26APRFUT', 'MCX:NICKEL26MAYFUT', 'MCX:NICKEL26JUNFUT', 'MCX:NICKEL26JULFUT',
    'MCX:NICKELMINI26APRFUT', 'MCX:NICKELMINI26MAYFUT', 'MCX:NICKELMINI26JUNFUT',
    'MCX:ALUMINIUM26APRFUT', 'MCX:ALUMINIUM26MAYFUT', 'MCX:ALUMINIUM26JUNFUT', 'MCX:ALUMINIUM26JULFUT',
    'MCX:ALUMINI26APRFUT', 'MCX:ALUMINI26MAYFUT', 'MCX:ALUMINI26JUNFUT',
    'MCX:MENTHAOIL26APRFUT', 'MCX:MENTHAOIL26MAYFUT', 'MCX:MENTHAOIL26JUNFUT',
    'MCX:COTTON26APRFUT', 'MCX:COTTON26MAYFUT', 'MCX:COTTON26JUNFUT',
    'MCX:COTTONCNDY26APRFUT', 'MCX:COTTONCNDY26MAYFUT',
    'MCX:KAPAS26APRFUT', 'MCX:KAPAS26MAYFUT', 'MCX:KAPAS26JUNFUT',
    'MCX:CASTORSEED26APRFUT', 'MCX:CASTORSEED26MAYFUT',
    'MCX:PEPPER26APRFUT', 'MCX:PEPPER26MAYFUT',
    'MCX:JEERA26APRFUT', 'MCX:JEERA26MAYFUT', 'MCX:JEERA26JUNFUT',
    'MCX:TMCFGRNZM26APRFUT', 'MCX:TMCFGRNZM26MAYFUT',
    'MCX:TURMERIC26APRFUT', 'MCX:TURMERIC26MAYFUT',
    'MCX:CORIANDER26APRFUT', 'MCX:CORIANDER26MAYFUT',
    'MCX:GUARSEED26APRFUT', 'MCX:GUARSEED26MAYFUT', 'MCX:GUARSEED26JUNFUT',
    'MCX:GUAREX26APRFUT', 'MCX:GUAREX26MAYFUT',
    'MCX:GUARGUM26APRFUT', 'MCX:GUARGUM26MAYFUT',
    'MCX:SOYBEAN26APRFUT', 'MCX:SOYBEAN26MAYFUT',
    'MCX:MUSTARD26APRFUT', 'MCX:MUSTARD26MAYFUT',
    'MCX:RMSEED26APRFUT', 'MCX:RMSEED26MAYFUT',
    'MCX:SOYMEAL26APRFUT', 'MCX:SOYMEAL26MAYFUT',
    'MCX:SOYOIL26APRFUT', 'MCX:SOYOIL26MAYFUT',
    'MCX:CPO26APRFUT', 'MCX:CPO26MAYFUT',
    'MCX:PALM26APRFUT', 'MCX:PALM26MAYFUT',
    'MCX:MCXBULLDEX26APRFUT', 'MCX:MCXBULLDEX26MAYFUT',
    'MCX:MCXMETLDEX26APRFUT', 'MCX:MCXMETLDEX26MAYFUT',
    'MCX:MCXENRGDEX26APRFUT', 'MCX:MCXENRGDEX26MAYFUT',
    'MCX:TIN26APRFUT', 'MCX:TIN26MAYFUT',
    'MCX:RUBBER26APRFUT', 'MCX:RUBBER26MAYFUT',
    'MCX:WHEATFOD26APRFUT', 'MCX:WHEATFOD26MAYFUT',
    'MCX:BARLEY26APRFUT', 'MCX:BARLEY26MAYFUT',
    'MCX:MAIZE26APRFUT', 'MCX:MAIZE26MAYFUT',
    'MCX:CHANA26APRFUT', 'MCX:CHANA26MAYFUT'
];

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

        // ── NSE: All stocks from all 4 indices (deduplicated) + index values ──
        const nseStocks = ALL_NSE_STOCKS.map(s => `NSE:${s}`);
        const nseIndices = ['NSE:NIFTY 50', 'NSE:NIFTY BANK', 'NSE:NIFTY FIN SERVICE', 'NSE:NIFTY MID SELECT'];

        // ── MCX: Normal + Mini commodities - nearest 2 expiries ──
        const mcxSymbols = await buildFutSymbols('MCX', MCX_BASES, 2);

        // ── NFO: Index futures + ALL Nifty50 stock futures - nearest 2 expiries ──
        const nfoIndexFut = await buildFutSymbols('NFO', NFO_INDICES, 3);
        const nfoStockFut = await buildFutSymbols('NFO', NIFTY50, 1); // nearest 1 expiry per stock
        const nfoSymbols = [...nfoIndexFut, ...nfoStockFut];

        const allSymbols = [...nseStocks, ...nseIndices, ...mcxSymbols, ...nfoSymbols];
        console.log(`Dashboard: NSE ${nseStocks.length + nseIndices.length} | MCX ${mcxSymbols.length} | NFO ${nfoSymbols.length} = ${allSymbols.length} total`);

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
    const rawQuotes = await fetchQuotesBatch([...POPULAR_SYMBOLS]);
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
