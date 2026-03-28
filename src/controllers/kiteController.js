const kiteAuthService = require('../services/KiteAuthService');

/**
 * Controller to handle Kite authentication requests.
 */
class KiteController {
    
    login = async (req, res) => {
        try {
            const userId = req.user.id;
            const url = `${kiteAuthService.getLoginURL()}&state=${userId}`;
            res.json({ login_url: url });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    callback = async (req, res) => {
        const { request_token, state: userId, status } = req.query;

        if (status === 'cancelled') {
            return res.send(`<html><body><h1>Login Cancelled</h1><script>setTimeout(()=>window.close(),3000)</script></body></html>`);
        }

        if (!request_token || !userId) {
            return res.status(400).send(`<html><body><h1>Error</h1><p>Invalid request from Zerodha.</p></body></html>`);
        }

        try {
            const session = await kiteAuthService.handleCallback(userId, request_token);
            
            const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
            res.send(`
                <html><body style="background:#1a1a2e;color:#fff;text-align:center;padding:50px;font-family:sans-serif;">
                    <h1 style="color:#2ecc71">✅ Kite Connected!</h1>
                    <p>User: <strong>${session.user_name || 'N/A'}</strong></p>
                    <p>Redirecting back...</p>
                    <script>
                        setTimeout(() => {
                            window.location.href = '${FRONTEND_URL}/kite-dashboard';
                        }, 2000);
                    </script>
                </body></html>
            `);
        } catch (err) {
            res.status(500).send(`<html><body><h1>Auth Failed</h1><p>${err.message}</p></body></html>`);
        }
    }

    status = async (req, res) => {
        try {
            const userId = req.user.id;
            const status = await kiteAuthService.getStatus(userId);
            res.json(status);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    disconnect = async (req, res) => {
        try {
            const userId = req.user.id;
            await kiteAuthService.disconnect(userId);
            res.json({ success: true, message: 'Kite disconnected' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    getMargins = async (req, res) => {
        try {
            const userId = req.user.id;
            const kite = await kiteAuthService.getKiteInstance(userId);
            const margins = await kite.getMargins();
            res.json(margins);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }

    getProfile = async (req, res) => {
        try {
            const userId = req.user.id;
            const kite = await kiteAuthService.getKiteInstance(userId);
            const profile = await kite.getProfile();
            res.json(profile);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    }
}

module.exports = new KiteController();
