const db = require('./src/config/db');

async function run() {
    try {
        const [rows] = await db.execute('DESCRIBE payment_requests');
        console.log(JSON.stringify(rows, null, 2));
        process.exit();
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}
run();
