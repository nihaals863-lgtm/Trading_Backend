const { KiteTicker } = require('kiteconnect');
const kiteAuthService = require('./KiteAuthService');
const socketManager = require('../websocket/SocketManager');
const EventEmitter = require('events');

// ── Twelve Data config for Crypto + Forex ──
const TWELVE_DATA_KEY = process.env.TWELVE_DATA_API_KEY || 'demo';
const TWELVE_BASE = 'https://api.twelvedata.com';

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

/**
 * Service to manage real-time market data from Zerodha + Twelve Data.
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

        // Crypto + Forex state
        this.cryptoPrices = {};
        this.forexPrices = {};
        this.apiBaselines = {};  // Real prices from API
        this.pulsedPrices = {};  // Current pulsed price shown on UI
        this.twelveDataInterval = null;
        this.pulseInterval = null;
    }

    async init(userId) {
        if (this.ticker || this.isConnecting) return;
        this.isConnecting = true;

        try {
            const repo = require('../repositories/KiteRepository');
            const userSession = await repo.getSessionByUserId(userId);

            if (!userSession || !userSession.access_token) {
                console.log('⚠️  Kite credentials not available for user ' + userId + ', falling back to mock engine');
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
                this.stopMockEngine();
                this.resubscribe();
            });

            this.ticker.on('ticks', (ticks) => {
                this.handleTicks(ticks);
            });

            this.ticker.on('error', (err) => {
                const errMsg = err?.message || String(err);
                if (errMsg.includes('403') || errMsg.includes('401') || errMsg.includes('connection')) {
                    console.error('⚠️  Critical Ticker Error:', errMsg);
                    if (this.ticker) {
                        try {
                            const oldTicker = this.ticker;
                            this.ticker = null; // Clear first to prevent recursion
                            oldTicker.autoReconnect(false);
                            oldTicker.disconnect();
                        } catch (e) {}
                        this.startMockEngine();
                    }
                } else {
                    console.error('⚠️  Ticker Error:', errMsg);
                }
            });

            this.ticker.on('disconnect', () => {
                console.warn('⚠️  Ticker disconnected');
                if (this.ticker) {
                    this.ticker = null;
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
        console.log('🧪 Starting Mock Price Engine');
        this.mockInterval = setInterval(() => {
            const updates = {};
            const io = socketManager.getIo();

            // Simulate some volatility for subscribed instruments
            this.subscribedTokens.forEach(token => {
                const symbol = this.instrumentMap[token] || `TOKEN_${token}`;
                let current = this.prices[symbol]?.ltp || 1000;
                const change = (Math.random() - 0.5) * (current * 0.001); // 0.1% volatility
                const newPrice = current + change;

                const data = {
                    symbol,
                    ltp: parseFloat(newPrice.toFixed(2)),
                    change: parseFloat(change.toFixed(2)),
                    volume: (this.prices[symbol]?.volume || 1000) + Math.floor(Math.random() * 10),
                    ohlc: this.prices[symbol]?.ohlc || { open: newPrice, high: newPrice, low: newPrice, close: newPrice }
                };

                this.prices[symbol] = data;
                updates[symbol] = data;
            });

            if (io && Object.keys(updates).length > 0) {
                io.emit('price_update', updates);
            }
        }, 1000);
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
            
            const data = {
                symbol,
                ltp: tick.last_price,
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
        const tNum = Number(token);
        this.instrumentMap[tNum] = symbol;
        this.subscribedTokens.add(tNum);
        
        if (this.ticker && this.ticker.connected) {
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
        const tokens = Array.from(this.subscribedTokens);
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
            console.log('📉 Ticker Shutdown');
        }
        this.stopCryptoForex();
    }

    // ══════════════════════════════════════════════════════
    //   CRYPTO + FOREX (Twelve Data) — separate intervals
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

    // Get cached crypto/forex data (for REST fallback)
    getCryptoPrices() { return Object.values(this.cryptoPrices); }
    getForexPrices() { return Object.values(this.forexPrices); }
}

module.exports = new MarketDataService();
