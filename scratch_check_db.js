const db = require('./src/config/db');

async function checkTables() {
    try {
        const [tables] = await db.query('SHOW TABLES');
        console.log('Tables in database:', tables);
        
        for (const row of tables) {
            const tableName = Object.values(row)[0];
            try {
                const [status] = await db.query(`CHECK TABLE \`${tableName}\``);
                console.log(`Status of ${tableName}:`, status);
            } catch (err) {
                console.error(`Error checking ${tableName}:`, err.message);
            }
        }
    } catch (err) {
        console.error('Error fetching tables:', err.message);
    } finally {
        process.exit();
    }
}

checkTables();
