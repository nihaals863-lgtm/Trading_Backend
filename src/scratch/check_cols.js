const mysql = require('mysql2/promise');

async function checkCols() {
    const connection = await mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: '',
        database: 'traderdb'
    });

    try {
        const [rows] = await connection.execute('SHOW COLUMNS FROM trades');
        console.log(rows.map(r => r.Field));
    } catch (err) {
        console.error(err);
    } finally {
        await connection.end();
    }
}

checkCols();
