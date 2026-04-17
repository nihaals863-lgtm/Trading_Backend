const mysql = require('mysql2/promise');

async function checkTrades() {
    const connection = await mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: '',
        database: 'traderdb'
    });

    try {
        console.log('--- Sample Trades ---');
        const [rows] = await connection.execute('SELECT symbol, market_type, status FROM trades LIMIT 10');
        console.log(rows);
        
        console.log('\n--- Distinct Market Types ---');
        const [mTypes] = await connection.execute('SELECT DISTINCT market_type FROM trades');
        console.log(mTypes);

        console.log('\n--- Distinct Statuses ---');
        const [statuses] = await connection.execute('SELECT DISTINCT status FROM trades');
        console.log(statuses);

    } catch (err) {
        console.error(err);
    } finally {
        await connection.end();
    }
}

checkTrades();
