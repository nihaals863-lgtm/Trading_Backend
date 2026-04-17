/* const { KiteTicker } = require('kiteconnect');
const EventEmitter = require('events');
const WebSocket = require('ws');
const axios = require('axios');
const socketManager = require('../websocket/SocketManager');

const BINANCE_REST_BASE = 'https://api.binance.com/api/v3';
const BINANCE_WS_BASE = 'wss://stream.binance.com:9443/stream?streams=';
const TWELVE_BASE = 'https://api.twelvedata.com';
const TWELVE_DATA_KEY = process.env.TWELVE_DATA_API_KEY || 'demo';

const CRYPTO_SYMBOLS = ['BTC/USD', 'ETH/USD', 'BNB/USD', 'SOL/USD', 'XRP/USD', 'ADA/USD', 'DOGE/USD', 'DOT/USD', 'MATIC/USD', 'AVAX/USD'];
const FOREX_SYMBOLS = ['XAU/USD', 'XAG/USD', 'USD/INR', 'EUR/INR', 'GBP/USD', 'USD/JPY', 'USD/CHF', 'AUD/CAD', 'EUR/USD', 'GBP/INR'];

const SYMBOL_META = {
    'BTC/USD': { name: 'Bitcoin', category: 'crypto' },
    'ETH/USD': { name: 'Ethereum', category: 'crypto' },
    'BNB/USD': { name: 'BNB', category: 'crypto' },
    'SOL/USD': { name: 'Solana', category: 'crypto' },
    'XRP/USD': { name: 'Ripple', category: 'crypto' },
    'ADA/USD': { name: 'Cardano', category: 'crypto' },
    'DOGE/USD': { name: 'Dogecoin', category: 'crypto' },
    'DOT/USD': { name: 'Polkadot', category: 'crypto' },
    'MATIC/USD': { name: 'Polygon', category: 'crypto' },
    'AVAX/USD': { name: 'Avalanche', category: 'crypto' },
    'XAU/USD': { name: 'Gold', category: 'commodity' },
    'XAG/USD': { name: 'Silver', category: 'commodity' },
    'USD/INR': { name: 'USD/INR', category: 'forex' },
    'EUR/INR': { name: 'EUR/INR', category: 'forex' },
    'GBP/USD': { name: 'GBP/USD', category: 'forex' },
    'USD/JPY': { name: 'USD/JPY', category: 'forex' },
    'USD/CHF': { name: 'USD/CHF', category: 'forex' },
    'AUD/CAD': { name: 'AUD/CAD', category: 'forex' },
    'EUR/USD': { name: 'EUR/USD', category: 'forex' },
    'GBP/INR': { name: 'GBP/INR', category: 'forex' }
};

class MarketDataService extends EventEmitter {
    constructor() {
        super();
        this.ticker = null;
        this.isConnecting = false;
        this.prices = {};
        this.subscribedTokens = new Set();
        this.subscribedSymbols = new Set();
        this.instrumentMap = {};

        this.cryptoPrices = {};
        this.forexPrices = {};
        this.frontendToBinance = {};
        this.binanceToFrontend = {};
        this.binanceWs = null;
        this.reconnectAttempts = 0;
        this.isBinanceActive = false;
        this.forexInterval = null;
        this.mockInterval = null;

        this._initMappings();
    }

    _initMappings() {
        CRYPTO_SYMBOLS.forEach((sym) => {
            const bSym = sym.replace('/', '') + 'T';
            this.frontendToBinance[sym] = bSym.toLowerCase();
            this.binanceToFrontend[bSym.toUpperCase()] = sym;
        });
    }

    async init(userId) {
        if (this.ticker || this.isConnecting) return;
        this.isConnecting = true;
        try {
            const repo = require('../repositories/KiteRepository');
            const session = await repo.getSessionByUserId(userId);
            if (!session?.access_token) {
                this.startMockEngine();
                return;
            }

            this.ticker = new KiteTicker({
                api_key: process.env.KITE_API_KEY,
                access_token: session.access_token
            });
            this.ticker.autoReconnect(true, 50, 5);
            this.ticker.on('connect', () => {
                this.stopMockEngine();
                this.resubscribe();
            });
            this.ticker.on('ticks', (ticks) => this.handleTicks(ticks));
            this.ticker.on('error', () => this.startMockEngine());
            this.ticker.on('disconnect', () => this.startMockEngine());
            this.ticker.connect();
        } catch (_) {
            this.startMockEngine();
        } finally {
            this.isConnecting = false;
        }
    }

    startMockEngine() {
        if (this.mockInterval) return;
        this.mockInterval = setInterval(() => {
            const updates = {};
            this.subscribedTokens.forEach((token) => {
                const symbol = this.instrumentMap[token] || `TOKEN_${token}`;
                updates[symbol] = this._buildMock(symbol);
            });
            this.subscribedSymbols.forEach((symbol) => {
                updates[symbol] = this._buildMock(symbol);
            });
            if (Object.keys(updates).length) socketManager.getIo()?.emit('price_update', updates);
        }, 400);
    }

    stopMockEngine() {
        if (!this.mockInterval) return;
        clearInterval(this.mockInterval);
        this.mockInterval = null;
    }

    _buildMock(symbol) {
        const current = this.prices[symbol]?.ltp || 1000;
        const delta = (Math.random() - 0.5) * (current * 0.002);
        const ltp = parseFloat((current + delta).toFixed(2));
        const data = {
            symbol,
            ltp,
            bid: parseFloat((ltp * 0.9997).toFixed(2)),
            ask: parseFloat((ltp * 1.0003).toFixed(2)),
            change: parseFloat(delta.toFixed(2)),
            volume: (this.prices[symbol]?.volume || 10000) + Math.floor(Math.random() * 50)
        };
        this.prices[symbol] = data;
        return data;
    }

    handleTicks(ticks) {
        const updates = {};
        ticks.forEach((tick) => {
            const token = String(tick.instrument_token);
            const symbol = this.instrumentMap[token] || token;
            updates[symbol] = {
                symbol,
                ltp: tick.last_price,
                bid: tick.depth?.buy?.[0]?.price || 0,
                ask: tick.depth?.sell?.[0]?.price || 0,
                change: tick.net_change || 0,
                volume: tick.volume_traded || 0,
                ohlc: tick.ohlc || {},
                depth: tick.depth || {}
            };
            this.prices[symbol] = updates[symbol];
        });
        if (Object.keys(updates).length) socketManager.getIo()?.emit('price_update', updates);
        this.emit('update', updates);
    }

    subscribe(symbol, token) {
        if (!token) {
            this.subscribedSymbols.add(symbol);
            this.startMockEngine();
            return;
        }
        const sToken = String(token);
        this.instrumentMap[sToken] = symbol;
        this.subscribedTokens.add(sToken);
        if (this.ticker?.connected) {
            const t = parseInt(sToken, 10);
            this.ticker.subscribe([t]);
            this.ticker.setMode(this.ticker.modeFull, [t]);
        }
    }

    resubscribe() {
        if (!this.ticker?.connected) return;
        const tokens = Array.from(this.subscribedTokens).map((t) => parseInt(t, 10));
        if (!tokens.length) return;
        this.ticker.subscribe(tokens);
        this.ticker.setMode(this.ticker.modeFull, tokens);
    }

    async startCryptoForex() {
        if (this.isBinanceActive) return;
        this.isBinanceActive = true;
        await this._fetchInitialBinance();
        this._connectBinance();
        if (!this.forexInterval) {
            this.forexInterval = setInterval(() => this._fetchForex(), 15000);
            this._fetchForex();
        }
    }

    stopCryptoForex() {
        this.isBinanceActive = false;
        if (this.binanceWs) this.binanceWs.close();
        this.binanceWs = null;
        if (this.forexInterval) clearInterval(this.forexInterval);
        this.forexInterval = null;
    }

    async _fetchInitialBinance() {
        try {
            const symbols = CRYPTO_SYMBOLS.map((s) => `"${this.frontendToBinance[s].toUpperCase()}"`).join(',');
            const response = await axios.get(`${BINANCE_REST_BASE}/ticker/24hr?symbols=[${symbols}]`);
            response.data.forEach((item) => {
                const symbol = this.binanceToFrontend[item.symbol];
                if (!symbol) return;
                this.cryptoPrices[symbol] = {
                    symbol,
                    name: SYMBOL_META[symbol]?.name || symbol,
                    category: 'crypto',
                    type: 'CRYPTO',
                    ltp: parseFloat(item.lastPrice),
                    change: parseFloat(item.priceChange),
                    chg_pct: item.priceChangePercent
                };
            });
            this._broadcast(Object.values(this.cryptoPrices));
        } catch (_) {}
    }

    _connectBinance() {
        if (!this.isBinanceActive) return;
        const streams = CRYPTO_SYMBOLS.map((s) => this.frontendToBinance[s]).map((s) => `${s}@miniTicker/${s}@bookTicker`).join('/');
        this.binanceWs = new WebSocket(`${BINANCE_WS_BASE}${streams}`);
        this.binanceWs.on('message', (raw) => {
            const msg = JSON.parse(raw);
            if (!msg?.stream || !msg?.data) return;
            const [rawSymbol, t] = msg.stream.split('@');
            const symbol = this.binanceToFrontend[String(rawSymbol).toUpperCase()];
            if (!symbol) return;
            const current = this.cryptoPrices[symbol] || { symbol, type: 'CRYPTO', category: 'crypto', name: SYMBOL_META[symbol]?.name || symbol };
            if (t === 'miniTicker') {
                const ltp = parseFloat(msg.data.c);
                const open = parseFloat(msg.data.o);
                current.ltp = ltp;
                current.change = parseFloat((ltp - open).toFixed(4));
                current.chg_pct = open ? (((ltp - open) / open) * 100).toFixed(2) : '0.00';
            } else {
                current.bid = parseFloat(msg.data.b);
                current.ask = parseFloat(msg.data.a);
            }
            this.cryptoPrices[symbol] = current;
            this._broadcast(Object.values(this.cryptoPrices));
        });
    }

    async _fetchForex() {
        try {
            const response = await axios.get(`${TWELVE_BASE}/quote?symbol=${FOREX_SYMBOLS.join(',')}&apikey=${TWELVE_DATA_KEY}`);
            Object.entries(response.data || {}).forEach(([symbol, val]) => {
                if (!val || (!val.price && !val.close)) return;
                this.forexPrices[symbol] = {
                    symbol,
                    name: SYMBOL_META[symbol]?.name || symbol,
                    category: 'forex',
                    type: 'FOREX',
                    ltp: parseFloat(val.close || val.price || 0),
                    bid: parseFloat(val.bid || val.close || 0),
                    ask: parseFloat(val.ask || val.close || 0),
                    change: parseFloat(val.change || 0),
                    chg_pct: val.percent_change || '0.00'
                };
            });
            this._broadcast(Object.values(this.forexPrices));
        } catch (_) {}
    }

    _broadcast(items) {
        if (!items?.length) return;
        const payload = {};
        items.forEach((item) => { payload[item.symbol] = item; });
        socketManager.getIo()?.emit('price_update', payload);
    }

    getPrice(symbol) {
        return this.prices[symbol];
    }

    getCryptoPrices() {
        return Object.values(this.cryptoPrices);
    }

    getForexPrices() {
        return Object.values(this.forexPrices);
    }

    shutdown() {
        if (this.ticker) this.ticker.disconnect();
        this.ticker = null;
        this.stopMockEngine();
        this.stopCryptoForex();
    }
}

module.exports = new MarketDataService();
*/
/* const { KiteTicker } = require('kiteconnect');
const socketManager = require('../websocket/SocketManager');
const EventEmitter = require('events');
const WebSocket = require('ws');
const axios = require('axios');

const BINANCE_REST_BASE = 'https://api.binance.com/api/v3';
const BINANCE_WS_BASE = 'wss://stream.binance.com:9443/stream?streams=';

const CRYPTO_SYMBOLS_LIST = [
    'BTC/USD', 'ETH/USD', 'BNB/USD', 'SOL/USD', 'XRP/USD',
    'ADA/USD', 'DOGE/USD', 'DOT/USD', 'MATIC/USD', 'AVAX/USD'
];

const FOREX_SYMBOLS_LIST = [
    'XAU/USD', 'XAG/USD', 'USD/INR', 'EUR/INR', 'GBP/USD',
    'USD/JPY', 'USD/CHF', 'AUD/CAD', 'EUR/USD', 'GBP/INR'
];

const SYMBOL_META = {
    'BTC/USD': { name: 'Bitcoin', category: 'crypto' },
    'ETH/USD': { name: 'Ethereum', category: 'crypto' },
    'BNB/USD': { name: 'BNB', category: 'crypto' },
    'SOL/USD': { name: 'Solana', category: 'crypto' },
    'XRP/USD': { name: 'Ripple', category: 'crypto' },
    'ADA/USD': { name: 'Cardano', category: 'crypto' },
    'DOGE/USD': { name: 'Dogecoin', category: 'crypto' },
    'DOT/USD': { name: 'Polkadot', category: 'crypto' },
    'MATIC/USD': { name: 'Polygon', category: 'crypto' },
    'AVAX/USD': { name: 'Avalanche', category: 'crypto' },
    'XAU/USD': { name: 'Gold', category: 'commodity' },
    'XAG/USD': { name: 'Silver', category: 'commodity' },
    'USD/INR': { name: 'USD/INR', category: 'forex' },
    'EUR/INR': { name: 'EUR/INR', category: 'forex' },
    'GBP/USD': { name: 'GBP/USD', category: 'forex' },
    'USD/JPY': { name: 'USD/JPY', category: 'forex' },
    'USD/CHF': { name: 'USD/CHF', category: 'forex' },
    'AUD/CAD': { name: 'AUD/CAD', category: 'forex' },
    'EUR/USD': { name: 'EUR/USD', category: 'forex' },
    'GBP/INR': { name: 'GBP/INR', category: 'forex' },
};

const TWELVE_DATA_KEY = process.env.TWELVE_DATA_API_KEY || 'demo';
const TWELVE_BASE = 'https://api.twelvedata.com';

class MarketDataService extends EventEmitter {
    constructor() {
        super();
        this.ticker = null;
        this.prices = {};
        this.subscribedTokens = new Set();
        this.subscribedSymbols = new Set();
        this.instrumentMap = {};
        this.isConnecting = false;

        this.cryptoPrices = {};
        this.forexPrices = {};
        this.binanceWs = null;
        this.reconnectAttempts = 0;
        this.isBinanceActive = false;
        this.forexInterval = null;

        this.binanceToFrontend = {};
        this.frontendToBinance = {};
        this._initMappings();
    }

    _initMappings() {
        CRYPTO_SYMBOLS_LIST.forEach((sym) => {
            const bSym = this.mapToBinance(sym);
            this.frontendToBinance[sym] = bSym.toLowerCase();
            this.binanceToFrontend[bSym.toUpperCase()] = sym;
        });
    }

    mapToBinance(symbol) {
        return symbol.replace('/', '') + 'T';
    }

    async init(userId) {
        if (this.ticker || this.isConnecting) return;
        this.isConnecting = true;
        try {
            const repo = require('../repositories/KiteRepository');
            const userSession = await repo.getSessionByUserId(userId);
            if (!userSession || !userSession.access_token) {
                this.startMockEngine();
                return;
            }

            this.ticker = new KiteTicker({
                api_key: process.env.KITE_API_KEY,
                access_token: userSession.access_token
            });
            this.ticker.autoReconnect(true, 50, 5);

            this.ticker.on('connect', () => {
                console.log('📈 Zerodha Ticker Connected');
                this.stopMockEngine();
                this.resubscribe();
            });

            this.ticker.on('ticks', (ticks) => this.handleTicks(ticks));
            this.ticker.on('error', (err) => {
                console.error('⚠️  Ticker Error:', err?.message || err);
                this.startMockEngine();
            });
            this.ticker.on('disconnect', () => {
                console.warn('⚠️  Ticker disconnected, using mock engine');
                this.startMockEngine();
            });

            this.ticker.connect();
        } catch (err) {
            console.error('⚠️  Ticker init failed:', err.message);
            this.startMockEngine();
        } finally {
            this.isConnecting = false;
        }
    }

    startMockEngine() {
        if (this.mockInterval) return;
        console.log('🧪 Starting Mock Price Engine (400ms ticks)');
        this.mockInterval = setInterval(() => {
            const updates = {};
            const io = socketManager.getIo();

            this.subscribedTokens.forEach((token) => {
                const symbol = this.instrumentMap[token] || `TOKEN_${token}`;
                this._generateMockUpdate(symbol, updates);
            });
            this.subscribedSymbols.forEach((symbol) => {
                this._generateMockUpdate(symbol, updates);
            });

            Object.values(this.cryptoPrices).forEach((p) => {
                const fluctuate = (Math.random() - 0.5) * (p.ltp * 0.0005);
                p.ltp = parseFloat((p.ltp + fluctuate).toFixed(4));
                updates[p.symbol] = p;
            });
            Object.values(this.forexPrices).forEach((p) => {
                const fluctuate = (Math.random() - 0.5) * (p.ltp * 0.0003);
                p.ltp = parseFloat((p.ltp + fluctuate).toFixed(4));
                updates[p.symbol] = p;
            });

            if (io && Object.keys(updates).length > 0) {
                io.emit('price_update', updates);
            }
        }, 400);
    }

    _generateMockUpdate(symbol, updates) {
        const current = this.prices[symbol]?.ltp || 1000;
        const change = (Math.random() - 0.5) * (current * 0.002);
        const newPrice = current + change;
        const bid = newPrice - (newPrice * 0.0003);
        const ask = newPrice + (newPrice * 0.0003);
        const data = {
            symbol,
            ltp: parseFloat(newPrice.toFixed(2)),
            bid: parseFloat(bid.toFixed(2)),
            ask: parseFloat(ask.toFixed(2)),
            change: parseFloat(change.toFixed(2)),
            volume: (this.prices[symbol]?.volume || 10000) + Math.floor(Math.random() * 50),
            ohlc: this.prices[symbol]?.ohlc || { open: newPrice, high: newPrice, low: newPrice, close: newPrice }
        };
        this.prices[symbol] = data;
        updates[symbol] = data;
    }

    stopMockEngine() {
        if (!this.mockInterval) return;
        clearInterval(this.mockInterval);
        this.mockInterval = null;
        console.log('🧪 Stopped Mock Price Engine');
    }

    handleTicks(ticks) {
        const io = socketManager.getIo();
        const updates = {};
        ticks.forEach((tick) => {
            const token = String(tick.instrument_token);
            const symbol = this.instrumentMap[token] || token;
            const bid = tick.depth?.buy?.[0]?.price || 0;
            const ask = tick.depth?.sell?.[0]?.price || 0;
            const data = {
                symbol,
                ltp: tick.last_price,
                bid,
                ask,
                change: tick.net_change || 0,
                volume: tick.volume_traded || 0,
                ohlc: tick.ohlc || {},
                depth: tick.depth || {}
            };
            this.prices[symbol] = data;
            updates[symbol] = data;
        });
        if (io && Object.keys(updates).length > 0) io.emit('price_update', updates);
        this.emit('update', updates);
    }

    subscribe(symbol, token) {
        if (!token) {
            this.subscribedSymbols.add(symbol);
            this.startMockEngine();
            return;
        }
        const sToken = String(token);
        this.instrumentMap[sToken] = symbol;
        this.subscribedTokens.add(sToken);
        if (this.ticker && this.ticker.connected) {
            const tokenNum = parseInt(sToken, 10);
            this.ticker.subscribe([tokenNum]);
            this.ticker.setMode(this.ticker.modeFull, [tokenNum]);
        } else {
            this.startMockEngine();
        }
    }

    resubscribe() {
        if (!this.ticker || !this.ticker.connected) return;
        const tokens = Array.from(this.subscribedTokens).map((t) => parseInt(t, 10));
        if (tokens.length > 0) {
            this.ticker.subscribe(tokens);
            this.ticker.setMode(this.ticker.modeFull, tokens);
            console.log(`📊 Total Real Subscriptions: ${tokens.length}`);
        }
    }

    getPrice(symbol) {
        return this.prices[symbol];
    }

    shutdown() {
        if (this.ticker) {
            this.ticker.disconnect();
            this.ticker = null;
        }
        this.stopCryptoForex();
    }

    async startCryptoForex() {
        if (this.isBinanceActive) return;
        this.isBinanceActive = true;
        console.log('🌐 Starting Crypto (Binance) + Forex (Twelve Data) feeds');
        await this._fetchInitialBinanceData();
        this._connectBinanceWs();
        if (!this.forexInterval) {
            this.forexInterval = setInterval(() => this._fetchForexData(), 15000);
            this._fetchForexData();
        }
    }

    stopCryptoForex() {
        this.isBinanceActive = false;
        if (this.binanceWs) {
            this.binanceWs.close();
            this.binanceWs = null;
        }
        if (this.forexInterval) {
            clearInterval(this.forexInterval);
            this.forexInterval = null;
        }
    }

    async _fetchForexData() {
        const symbols = FOREX_SYMBOLS_LIST.join(',');
        try {
            const url = `${TWELVE_BASE}/quote?symbol=${symbols}&apikey=${TWELVE_DATA_KEY}`;
            const response = await axios.get(url);
            const data = response.data;
            const updates = [];
            for (const [sym, val] of Object.entries(data)) {
                if (!val || (!val.price && !val.close)) continue;
                const meta = SYMBOL_META[sym] || { name: sym, category: 'forex' };
                const entry = {
                    symbol: sym,
                    name: meta.name,
                    category: meta.category,
                    type: 'forex',
                    ltp: parseFloat(val.close || val.price || 0),
                    bid: parseFloat(val.bid || val.close || 0),
                    ask: parseFloat(val.ask || val.close || 0),
                    change: parseFloat(val.change || 0),
                    chg_pct: val.percent_change || '0.00',
                    direction: parseFloat(val.change) >= 0 ? 'up' : 'down'
                };
                this.forexPrices[sym] = entry;
                updates.push(entry);
            }
            if (updates.length > 0) this._broadcastPriceUpdates(Object.values(this.forexPrices));
        } catch (err) {
            if (!String(err.message || '').includes('429')) {
                console.warn('⚠️ Twelve Data Forex error:', err.message);
            }
        }
    }

    async _fetchInitialBinanceData() {
        try {
            const symbols = CRYPTO_SYMBOLS_LIST.map((s) => `"${this.frontendToBinance[s].toUpperCase()}"`).join(',');
            const response = await axios.get(`${BINANCE_REST_BASE}/ticker/24hr?symbols=[${symbols}]`);
            const updates = [];
            response.data.forEach((item) => {
                const frontendSym = this.binanceToFrontend[item.symbol];
                if (!frontendSym) return;
                const meta = SYMBOL_META[frontendSym] || { name: frontendSym, category: 'crypto' };
                const entry = {
                    symbol: frontendSym,
                    name: meta.name,
                    category: meta.category,
                    type: 'crypto',
                    ltp: parseFloat(item.lastPrice),
                    change: parseFloat(item.priceChange),
                    chg_pct: item.priceChangePercent,
                    direction: parseFloat(item.priceChange) >= 0 ? 'up' : 'down'
                };
                this.cryptoPrices[frontendSym] = entry;
                updates.push(entry);
            });

            FOREX_SYMBOLS_LIST.forEach((sym) => {
                if (!this.forexPrices[sym]) {
                    const meta = SYMBOL_META[sym] || { name: sym, category: 'forex' };
                    this.forexPrices[sym] = {
                        symbol: sym,
                        name: meta.name,
                        category: meta.category,
                        type: 'forex',
                        ltp: 0,
                        change: 0,
                        chg_pct: '0.00',
                        direction: 'neutral'
                    };
                }
            });

            this._broadcastPriceUpdates(updates);
            this._broadcastPriceUpdates(Object.values(this.forexPrices));
        } catch (err) {
            console.error('⚠️ Binance REST Error:', err.message);
        }
    }

    _connectBinanceWs() {
        if (!this.isBinanceActive) return;
        const bSymbols = CRYPTO_SYMBOLS_LIST.map((s) => this.frontendToBinance[s]);
        const streams = bSymbols.map((s) => `${s}@miniTicker/${s}@bookTicker`).join('/');
        this.binanceWs = new WebSocket(`${BINANCE_WS_BASE}${streams}`);

        this.binanceWs.on('open', () => {
            console.log('⚡ Binance WebSocket Connected');
            this.reconnectAttempts = 0;
        });
        this.binanceWs.on('message', (data) => this._handleBinanceMessage(JSON.parse(data)));
        this.binanceWs.on('error', (err) => console.error('⚠️ Binance WS Error:', err.message));
        this.binanceWs.on('close', () => {
            if (!this.isBinanceActive) return;
            const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
            setTimeout(() => {
                this.reconnectAttempts += 1;
                this._connectBinanceWs();
            }, delay);
        });
    }

    _handleBinanceMessage(msg) {
        if (!msg?.data || !msg?.stream) return;
        const [rawSymbol, rawType] = msg.stream.split('@');
        const bSymbol = (rawSymbol || '').toUpperCase();
        const type = rawType;
        const frontendSym = this.binanceToFrontend[bSymbol];
        if (!frontendSym) return;
        const current = this.cryptoPrices[frontendSym] || {};
        const data = msg.data;

        if (type === 'miniTicker') {
            const ltp = parseFloat(data.c);
            const open = parseFloat(data.o);
            const change = ltp - open;
            const chg_pct = open !== 0 ? ((change / open) * 100).toFixed(2) : '0.00';
            this.cryptoPrices[frontendSym] = {
                ...current,
                ltp,
                change: parseFloat(change.toFixed(4)),
                chg_pct,
                direction: change >= 0 ? 'up' : 'down'
            };
        } else if (type === 'bookTicker') {
            this.cryptoPrices[frontendSym] = {
                ...current,
                bid: parseFloat(data.b),
                ask: parseFloat(data.a)
            };
        }
        this._broadcastPriceUpdates(Object.values(this.cryptoPrices));
    }

    _broadcastPriceUpdates(data) {
        const io = socketManager.getIo();
        if (!io || !Array.isArray(data) || data.length === 0) return;
        const updates = {};
        data.forEach((item) => {
            updates[item.symbol] = { ...item, type: String(item.type || '').toUpperCase() };
        });
        io.emit('price_update', updates);
    }

    getCryptoPrices() { return Object.values(this.cryptoPrices); }
    getForexPrices() { return Object.values(this.forexPrices); }
}

module.exports = new MarketDataService();
*/
const { KiteTicker } = require('kiteconnect');
const kiteAuthService = require('./KiteAuthService');
const socketManager = require('../websocket/SocketManager');
const EventEmitter = require('events');
const WebSocket = require('ws');
const axios = require('axios');

// ── Binance Config ──
const BINANCE_REST_BASE = 'https://api.binance.com/api/v3';
const BINANCE_WS_BASE = 'wss://stream.binance.com:9443/stream?streams=';

const CRYPTO_SYMBOLS = 'BTC/USD,ETH/USD,BNB/USD,SOL/USD,XRP/USD,ADA/USD,DOGE/USD,DOT/USD,MATIC/USD,AVAX/USD';
const FOREX_SYMBOLS = 'XAU/USD,XAG/USD,USD/INR,EUR/INR,GBP/USD,USD/JPY,USD/CHF,AUD/CAD,EUR/USD,GBP/INR';
const ALL_TD_SYMBOLS = `${CRYPTO_SYMBOLS},${FOREX_SYMBOLS}`;

const SYMBOL_META = {
    'BTC/USD': { name: 'Bitcoin', category: 'crypto' },
    'ETH/USD': { name: 'Ethereum', category: 'crypto' },
    'BNB/USD': { name: 'BNB', category: 'crypto' },
    'SOL/USD': { name: 'Solana', category: 'crypto' },
    'XRP/USD': { name: 'Ripple', category: 'crypto' },
    'ADA/USD': { name: 'Cardano', category: 'crypto' },
    'DOGE/USD': { name: 'Dogecoin', category: 'crypto' },
    'DOT/USD': { name: 'Polkadot', category: 'crypto' },
    'MATIC/USD': { name: 'Polygon', category: 'crypto' },
    'AVAX/USD': { name: 'Avalanche', category: 'crypto' },
    'XAU/USD': { name: 'Gold', category: 'commodity' },
    'XAG/USD': { name: 'Silver', category: 'commodity' },
    'USD/INR': { name: 'USD/INR', category: 'forex' },
    'EUR/INR': { name: 'EUR/INR', category: 'forex' },
    'GBP/USD': { name: 'GBP/USD', category: 'forex' },
    'USD/JPY': { name: 'USD/JPY', category: 'forex' },
    'USD/CHF': { name: 'USD/CHF', category: 'forex' },
    'AUD/CAD': { name: 'AUD/CAD', category: 'forex' },
    'EUR/USD': { name: 'EUR/USD', category: 'forex' },
    'GBP/INR': { name: 'GBP/INR', category: 'forex' },
};

// ── Twelve Data Config (Forex Only) ──
const TWELVE_DATA_KEY = process.env.TWELVE_DATA_API_KEY || 'demo';
const TWELVE_BASE = 'https://api.twelvedata.com';

/**
 * Service to manage real-time market data from Zerodha + Binance.
 * Handles single master connection or per-user connection if needed.
 * Broadcasts all price updates via Socket.IO.
 */
class MarketDataService extends EventEmitter {
    constructor() {
        super();
        this.ticker = null;
        this.prices = {};
        this.subscribedTokens = new Set();
        this.instrumentMap = {}; // token -> symbol
        this.isConnecting = false;

        // Binance State
        this.cryptoPrices = {};
        this.forexPrices = {};
        this.apiBaselines = {};  // Real prices from API
        this.pulsedPrices = {};  // Current pulsed price shown on UI
        this.twelveDataInterval = null;
        this.pulseInterval = null;
    }

    async init(userId) {
        if (this.ticker || this.isConnecting) return;
        
        // Cooldown: If auth failed recently, don't try again for 5 minutes
        const now = Date.now();
        if (this.lastAuthFail && (now - this.lastAuthFail < 5 * 60 * 1000)) {
            this.startMockEngine();
            return;
        }

        this.isConnecting = true;
        try {
            const repo = require('../repositories/KiteRepository');
            const userSession = await repo.getSessionByUserId(userId);

            if (!userSession || !userSession.access_token) {
                this.startMockEngine();
                this.isConnecting = false;
                return;
            }

            this.ticker = new KiteTicker({
                api_key: process.env.KITE_API_KEY,
                access_token: userSession.access_token
            });

            this.ticker.autoReconnect(true, 50, 5);

            this.ticker.on('connect', () => {
                console.log('📈 Zerodha Ticker Connected');
                this.lastAuthFail = null; // Clear failure on success
                this.stopMockEngine();
                this.resubscribe();
            });

            this.ticker.on('ticks', (ticks) => {
                this.handleTicks(ticks);
            });

            this.ticker.on('error', (err) => {
                const errMsg = err?.message || String(err);
                if (errMsg.includes('403') || errMsg.includes('401')) {
                    console.error('⚠️  Critical Auth Error (403/401). Cooling down for 5 mins.');
                    this.lastAuthFail = Date.now();
                    if (this.ticker) {
                        try {
                            const oldTicker = this.ticker;
                            this.ticker = null; 
                            oldTicker.autoReconnect(false);
                            oldTicker.disconnect();
                            oldTicker.removeAllListeners();
                        } catch (e) {}
                        this.startMockEngine();
                    }
                } else {
                    console.error('⚠️  Ticker Error:', errMsg);
                }
            });

            this.ticker.on('disconnect', () => {
                if (this.ticker) {
                    console.warn('⚠️  Ticker disconnected, trying to recover...');
                    this.startMockEngine();
                }
            });

            this.ticker.connect();
        } catch (err) {
            console.error('⚠️  Ticker init failed:', err.message);
            this.startMockEngine();
        } finally {
            this.isConnecting = false;
        }
    }

    startMockEngine() {
        if (this.mockInterval) return;
        console.log('🧪 Starting Mock Price Engine (400ms ticks)');
        let tickCount = 0;
        this.mockInterval = setInterval(() => {
            const updates = {};
            const io = socketManager.getIo();

            // 1. Handle Kite Subscriptions (Tokens)
            this.subscribedTokens.forEach(token => {
                const symbol = this.instrumentMap[token] || `TOKEN_${token}`;
                this._generateMockUpdate(symbol, updates);
            });

            // 2. Handle Kite Subscriptions (Direct Symbols - Failsafe)
            if (this.subscribedSymbols) {
                this.subscribedSymbols.forEach(symbol => {
                    this._generateMockUpdate(symbol, updates);
                });
            }

            // 3. Handle Crypto/Forex micro-fluctuations
            Object.values(this.cryptoPrices).forEach(p => {
                const fluctuate = (Math.random() - 0.5) * (p.ltp * 0.0005);
                p.ltp = parseFloat((p.ltp + fluctuate).toFixed(4));
                updates[p.symbol] = p;
            });

            Object.values(this.forexPrices).forEach(p => {
                const fluctuate = (Math.random() - 0.5) * (p.ltp * 0.0003);
                p.ltp = parseFloat((p.ltp + fluctuate).toFixed(4));
                updates[p.symbol] = p;
            });

            if (io && Object.keys(updates).length > 0) {
                io.emit('price_update', updates);
                tickCount++;
            }
        }, 400);
    }

    _generateMockUpdate(symbol, updates) {
        let current = this.prices[symbol]?.ltp || 1000;
        const change = (Math.random() - 0.5) * (current * 0.002);
        const newPrice = current + change;
        const bid = newPrice - (newPrice * 0.0003);
        const ask = newPrice + (newPrice * 0.0003);

        const data = {
            symbol,
            ltp: parseFloat(newPrice.toFixed(2)),
            bid: parseFloat(bid.toFixed(2)),
            ask: parseFloat(ask.toFixed(2)),
            change: parseFloat(change.toFixed(2)),
            volume: (this.prices[symbol]?.volume || 10000) + Math.floor(Math.random() * 50),
            ohlc: this.prices[symbol]?.ohlc || { open: newPrice, high: newPrice, low: newPrice, close: newPrice }
        };

        this.prices[symbol] = data;
        updates[symbol] = data;
    }

    stopMockEngine() {
        if (this.mockInterval) {
            clearInterval(this.mockInterval);
            this.mockInterval = null;
            console.log('🧪 Stopped Mock Price Engine');
        }
    }

    handleTicks(ticks) {
        const io = socketManager.getIo();
        const updates = {};

        ticks.forEach(tick => {
            const symbol = this.instrumentMap[tick.instrument_token];
            if (!symbol) return;
            const bid = tick.depth?.buy?.[0]?.price || 0;
            const ask = tick.depth?.sell?.[0]?.price || 0;

            const data = {
                symbol,
                ltp: tick.last_price,
                bid: bid,
                ask: ask,
                change: tick.net_change || 0,
                volume: tick.volume_traded || 0,
                ohlc: tick.ohlc || {},
                depth: tick.depth || {}
            };

            this.prices[symbol] = data;
            updates[symbol] = data;
        });

        if (io && Object.keys(updates).length > 0) {
            io.emit('price_update', updates);
        }
        this.emit('update', updates);
    }

    subscribe(symbol, token) {
        if (!token) return;
        this.instrumentMap[token] = symbol;
        this.subscribedTokens.add(token);

        if (this.ticker && this.ticker.connected) {
            const tNum = Number(token);
            if (!Number.isFinite(tNum)) return;
            this.ticker.subscribe([tNum]);
            this.ticker.setMode(this.ticker.modeFull, [tNum]);
        }
    }

    bulkSubscribe(instruments) {
        if (!Array.isArray(instruments) || instruments.length === 0) return;

        const newTokens = [];
        instruments.forEach(({ symbol, token }) => {
            if (!token) return;
            const tNum = Number(token);
            this.instrumentMap[tNum] = symbol;
            if (!this.subscribedTokens.has(tNum)) {
                this.subscribedTokens.add(tNum);
                newTokens.push(tNum);
            }
        });

        if (newTokens.length > 0 && this.ticker && this.ticker.connected) {
            this.ticker.subscribe(newTokens);
            this.ticker.setMode(this.ticker.modeFull, newTokens);
            console.log(`📡 Bulk Subscribed to ${newTokens.length} instruments`);
        }
    }

    resubscribe() {
        if (!this.ticker || !this.ticker.connected) return;
        const tokens = Array.from(this.subscribedTokens).map(t => parseInt(t));
        if (tokens.length > 0) {
            this.ticker.subscribe(tokens);
            this.ticker.setMode(this.ticker.modeFull, tokens);
            console.log(`📊 Total Subscriptions: ${tokens.length}`);
        }
    }

    getPrice(symbol) {
        return this.prices[symbol] || null;
    }

    getPricesBatch(symbols) {
        const result = {};
        symbols.forEach(sym => {
            if (this.prices[sym]) result[sym] = this.prices[sym];
        });
        return result;
    }

    shutdown() {
        if (this.ticker) {
            this.ticker.disconnect();
            this.ticker = null;
        }
        this.stopCryptoForex();
    }

    // ══════════════════════════════════════════════════════
    //   BINANCE INTEGRATION (Crypto) + FOREX Fallback
    // ══════════════════════════════════════════════════════

    startCryptoForex() {
        if (this.twelveDataInterval) return;
        console.log('🌐 Starting High-Frequency Crypto/Forex Engine');

        // 1. Real API Fetch (every 15s to respect rate limits)
        this.twelveDataInterval = setInterval(() => this._fetchTwelveData(ALL_TD_SYMBOLS), 15000);

        // 2. Fast Pulse Timer (every 1s for ultra-fast UI movement)
        this.pulseInterval = setInterval(() => this._broadcastPulse(), 1000);

        // Immediate first fetch
        this._fetchTwelveData(ALL_TD_SYMBOLS);
    }

    stopCryptoForex() {
        if (this.twelveDataInterval) {
            clearInterval(this.twelveDataInterval);
            this.twelveDataInterval = null;
        }
        if (this.pulseInterval) {
            clearInterval(this.pulseInterval);
            this.pulseInterval = null;
        }
    }

    async _fetchTwelveData(symbols) {
        try {
            const url = `${TWELVE_BASE}/quote?symbol=${symbols}&apikey=${TWELVE_DATA_KEY}`;
            const response = await fetch(url);
            const data = await response.json();

            const updateBaseline = (sym, res) => {
                if (!res || (!res.price && !res.close)) return;
                const price = parseFloat(res.price || res.close || 0);
                this.apiBaselines[sym] = {
                    price,
                    change: parseFloat(res.change || 0),
                    chg_pct: res.percent_change || '0.00'
                };
                
                // Initialize pulsedPrice if not exists
                if (!this.pulsedPrices[sym]) this.pulsedPrices[sym] = price;
            };

            if (data.price || data.symbol) {
                updateBaseline(symbols.split(',')[0], data);
            } else {
                Object.entries(data).forEach(([sym, res]) => updateBaseline(sym, res));
            }
        } catch (err) {
            if (!err.message?.includes('429')) console.warn(`Twelve Data fetch error:`, err.message);
        }
    }

    _broadcastPulse() {
        const io = socketManager.getIo();
        if (!io) return;

        const cryptoUpdates = [];
        const forexUpdates = [];

        Object.entries(this.apiBaselines).forEach(([sym, base]) => {
            const meta = SYMBOL_META[sym] || { name: sym, category: sym.includes('/') ? 'forex' : 'crypto' };
            const type = meta.category === 'crypto' ? 'crypto' : 'forex';

            // Micro-fluctuation logic (every 1s)
            let ltp = this.pulsedPrices[sym] || base.price;
            
            // Gradually pull towards API baseline if drifting too far (>0.05% difference)
            const drift = (ltp - base.price) / base.price;
            if (Math.abs(drift) > 0.0005) {
                ltp = ltp - (drift * 0.1); // Pull back 10% of the drift
            }

            // Normal fluctuation (+/- 0.002%)
            const delta = (Math.random() - 0.5) * (ltp * 0.00004); 
            ltp = parseFloat((ltp + delta).toFixed(5));
            this.pulsedPrices[sym] = ltp;

            // Synthetic Spread (Synced with current pulsed LTP)
            const spreadFactor = type === 'crypto' ? 0.0001 : 0.0002;
            const bid = parseFloat((ltp * (1 - spreadFactor)).toFixed(5));
            const ask = parseFloat((ltp * (1 + spreadFactor)).toFixed(5));

            const entry = {
                symbol: sym,
                name: meta.name,
                category: meta.category,
                type,
                ltp,
                bid,
                ask,
                change: base.change,
                chg_pct: base.chg_pct,
                direction: base.change > 0 ? 'up' : base.change < 0 ? 'down' : 'neutral',
                updatedAt: new Date().toISOString()
            };

            if (type === 'crypto') {
                this.cryptoPrices[sym] = entry;
                cryptoUpdates.push(entry);
            } else {
                this.forexPrices[sym] = entry;
                forexUpdates.push(entry);
            }
        });

        if (cryptoUpdates.length > 0) {
            io.emit('market_data_update', { type: 'crypto', data: cryptoUpdates, timestamp: new Date().toISOString() });
        }
        if (forexUpdates.length > 0) {
            io.emit('market_data_update', { type: 'forex', data: forexUpdates, timestamp: new Date().toISOString() });
        }
    }

    async _fetchInitialBinanceData() {
        try {
            console.log('🔄 Fetching initial Binance ticker data...');
            const symbols = CRYPTO_SYMBOLS_LIST.map(s => `"${this.frontendToBinance[s].toUpperCase()}"`).join(',');
            const response = await axios.get(`${BINANCE_REST_BASE}/ticker/24hr?symbols=[${symbols}]`);

            const updates = [];
            response.data.forEach(item => {
                const frontendSym = this.binanceToFrontend[item.symbol];
                if (!frontendSym) return;

                const meta = SYMBOL_META[frontendSym] || { name: frontendSym, category: 'crypto' };
                const entry = {
                    symbol: frontendSym,
                    name: meta.name,
                    category: meta.category,
                    type: 'crypto',
                    ltp: parseFloat(item.lastPrice),
                    change: parseFloat(item.priceChange),
                    chg_pct: item.priceChangePercent,
                    direction: parseFloat(item.priceChange) >= 0 ? 'up' : 'down'
                };
                this.cryptoPrices[frontendSym] = entry;
                updates.push(entry);
            });

            // Initialize Forex with static/cached data or placeholders since Binance doesn't support it
            FOREX_SYMBOLS_LIST.forEach(sym => {
                if (!this.forexPrices[sym]) {
                    const meta = SYMBOL_META[sym] || { name: sym, category: 'forex' };
                    this.forexPrices[sym] = {
                        symbol: sym, name: meta.name, category: meta.category, type: 'forex',
                        ltp: 0, change: 0, chg_pct: '0.00', direction: 'neutral'
                    };
                }
            });

            this._broadcastBinanceUpdate('crypto', updates);
            this._broadcastBinanceUpdate('forex', Object.values(this.forexPrices));
        } catch (err) {
            console.error('⚠️ Binance REST Error:', err.message);
        }
    }

    _connectBinanceWs() {
        if (!this.isBinanceActive) return;

        const bSymbols = CRYPTO_SYMBOLS_LIST.map(s => this.frontendToBinance[s]);
        const streams = bSymbols.map(s => `${s}@miniTicker/${s}@bookTicker`).join('/');
        const url = `${BINANCE_WS_BASE}${streams}`;

        this.binanceWs = new WebSocket(url);

        this.binanceWs.on('open', () => {
            console.log('⚡ Binance WebSocket Connected');
            this.reconnectAttempts = 0;
        });

        this.binanceWs.on('message', (data) => {
            this._handleBinanceMessage(JSON.parse(data));
        });

        this.binanceWs.on('error', (err) => {
            console.error('⚠️ Binance WS Error:', err.message);
        });

        this.binanceWs.on('close', () => {
            if (this.isBinanceActive) {
                const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
                console.log(`🔄 Binance WS closed. Reconnecting in ${delay / 1000}s...`);
                setTimeout(() => {
                    this.reconnectAttempts++;
                    this._connectBinanceWs();
                }, delay);
            }
        });
    }

    _handleBinanceMessage(msg) {
        if (!msg.data || !msg.stream) return;

        const streamParts = msg.stream.split('@');
        const bSymbol = streamParts[0].toUpperCase();
        const type = streamParts[1]; // miniTicker or bookTicker
        const frontendSym = this.binanceToFrontend[bSymbol];

        if (!frontendSym) return;

        const current = this.cryptoPrices[frontendSym] || {};
        const data = msg.data;

        if (type === 'miniTicker') {
            const ltp = parseFloat(data.c);
            const open = parseFloat(data.o);
            const change = ltp - open;
            const chg_pct = open !== 0 ? ((change / open) * 100).toFixed(2) : '0.00';

            this.cryptoPrices[frontendSym] = {
                ...current,
                ltp,
                change: parseFloat(change.toFixed(4)),
                chg_pct,
                direction: change >= 0 ? 'up' : 'down'
            };
        } else if (type === 'bookTicker') {
            this.cryptoPrices[frontendSym] = {
                ...current,
                bid: parseFloat(data.b),
                ask: parseFloat(data.a)
            };
        }

        // Broadcast full list to prevent frontend from overwriting with single item
        this._broadcastBinanceUpdate('crypto', Object.values(this.cryptoPrices));
    }

    _broadcastBinanceUpdate(type, data) {
        const io = socketManager.getIo();
        if (io && data.length > 0) {
            // Unify with Kite updates so frontend can handle them same way
            const updates = {};
            data.forEach(item => {
                updates[item.symbol] = {
                    ...item,
                    type: item.type.toUpperCase()
                };
            });
            io.emit('price_update', updates);
        }
    }

    getCryptoPrices() { return Object.values(this.cryptoPrices); }
    getForexPrices() { return Object.values(this.forexPrices); }
}

module.exports = new MarketDataService();
