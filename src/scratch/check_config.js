const mysql = require('mysql2/promise');

async function checkConfig() {
    const connection = await mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: '',
        database: 'traderdb'
    });

    try {
        const [rows] = await connection.execute('SELECT user_id, config_json FROM client_settings LIMIT 5');
        rows.forEach(r => {
            console.log(`User ${r.user_id}:`);
            console.log(r.config_json ? JSON.stringify(JSON.parse(r.config_json), null, 2).substring(0, 500) : 'NULL');
        });
    } catch (err) {
        console.error(err);
    } finally {
        await connection.end();
    }
}

checkConfig();
