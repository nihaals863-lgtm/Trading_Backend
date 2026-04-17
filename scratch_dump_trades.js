const db = require('./src/config/db');

async function dumpTrades() {
    try {
        const [rows] = await db.execute('SELECT * FROM trades WHERE status = "OPEN"');
        console.log('--- OPEN TRADES IN DATABASE ---');
        console.log(JSON.stringify(rows, null, 2));
        console.log('--- END DUMP ---');
        process.exit(0);
    } catch (err) {
        console.error('Error dumping trades:', err);
        process.exit(1);
    }
}

dumpTrades();
