const db = require('./src/config/db');
const fs = require('fs');

async function run() {
    try {
        const [rows] = await db.execute('DESCRIBE payment_requests');
        fs.writeFileSync('payment_schema.txt', JSON.stringify(rows, null, 2));
        console.log('Done');
        process.exit();
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}
run();
