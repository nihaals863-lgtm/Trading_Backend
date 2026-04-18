const mysql = require('mysql2/promise');
require('dotenv').config();

async function resetDatabase() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
    });

    try {
        console.log('Dropping database traderdb...');
        await connection.query('DROP DATABASE IF EXISTS traderdb');
        console.log('Creating database traderdb...');
        await connection.query('CREATE DATABASE traderdb');
        console.log('✅ Database reset successfully');
    } catch (err) {
        console.error('❌ Error resetting database:', err.message);
    } finally {
        await connection.end();
        process.exit();
    }
}

resetDatabase();
