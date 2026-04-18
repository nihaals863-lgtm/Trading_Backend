const mysql = require('mysql2/promise');
require('dotenv').config();

async function getDatadir() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
    });

    try {
        const [res] = await connection.query('SHOW VARIABLES LIKE "datadir"');
        console.log('MySQL Data Directory:', res[0].Value);
        
        // Also try to list files in traderdb if possible via shell, but first get the path.
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await connection.end();
        process.exit();
    }
}

getDatadir();
