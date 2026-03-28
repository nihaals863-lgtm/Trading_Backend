const { KiteTicker } = require('kiteconnect');
const kiteAuthService = require('./KiteAuthService');
const socketManager = require('../websocket/SocketManager');
const EventEmitter = require('events');

/**
 * Service to manage real-time market data from Zerodha.
 * Handles single master connection or per-user connection if needed.
 */
class MarketDataService extends EventEmitter {
    constructor() {
        super();
        this.ticker = null;
        this.prices = {};
        this.subscribedTokens = new Set();
        this.instrumentMap = {}; // token -> symbol
        this.isConnecting = false;
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
                console.error('Ticker Error:', err.message);
                if (err.message?.includes('403')) {
                    this.startMockEngine();
                }
            });

            this.ticker.connect();
        } catch (err) {
            console.error('Ticker init failed:', err.message);
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
            const info = this.instrumentMap[tick.instrument_token];
            const symbol = info || tick.instrument_token;
            
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

        if (io) {
            io.emit('price_update', updates);
        }
        this.emit('update', updates);
    }

    subscribe(symbol, token) {
        if (!token) return;
        this.instrumentMap[token] = symbol;
        this.subscribedTokens.add(token);
        
        if (this.ticker && this.ticker.connected) {
            this.ticker.subscribe([token]);
            this.ticker.setMode(this.ticker.modeFull, [token]);
        } else if (!this.ticker) {
            // If ticker not active, ensure mock engine starts or resumes
            this.startMockEngine();
        }
    }

    resubscribe() {
        if (!this.ticker || !this.ticker.connected) return;
        const tokens = Array.from(this.subscribedTokens);
        if (tokens.length > 0) {
            this.ticker.subscribe(tokens);
            this.ticker.setMode(this.ticker.modeFull, tokens);
            console.log(`📊 Resubscribed to ${tokens.length} instruments`);
        }
    }

    getPrice(symbol) {
        return this.prices[symbol];
    }

    shutdown() {
        if (this.ticker) {
            this.ticker.disconnect();
            this.ticker = null;
            console.log('📉 Ticker Shutdown');
        }
    }
}

module.exports = new MarketDataService();
