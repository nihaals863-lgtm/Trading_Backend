const kiteRoutes = require('./src/routes/kiteRoutes');
const kiteService = require('./src/utils/kiteService');

// Mock req and res
const req = {
    user: { id: 1, role: 'SUPERADMIN' },
    query: {}
};
const res = {
    json: (data) => {
        console.log('--- WATCHLIST DATA ---');
        console.log('Total items:', data.length);
        if (data.length > 0) {
            console.log('First 5 items sample:');
            console.log(JSON.stringify(data.slice(0, 5), null, 2));
            
            const exchanges = [...new Set(data.map(d => d.symbol.split(':')[0]))];
            console.log('Exchanges present:', exchanges);
            
            const types = [...new Set(data.map(d => d.type))];
            console.log('Types present:', types);
        }
        process.exit(0);
    },
    status: (code) => ({
        json: (msg) => {
            console.error('Error', code, msg);
            process.exit(1);
        }
    })
};

// We need to bypass auth check and call the builder directly
// But the builder is internal. Let's try to set the token and use the route.
async function test() {
    // Note: This requires a valid KITE_API_KEY and session in the environment or DB.
    // Since we are in the workspace, we can try to use the existing kiteService.
    console.log('Testing /market/watchlist builder...');
    // The route handler is: router.get('/market/watchlist', ...);
    // Since we can't easily call the express route without a server, we'll just look at the code logic in kiteRoutes.js
}

test();
