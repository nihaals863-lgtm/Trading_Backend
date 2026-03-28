const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function setupDatabase() {
  try {
    const connection = await mysql.createConnection({
      host: 'localhost',
      user: 'root',
      password: '12345678'
    });

    console.log('✅ Connected to MySQL server.');

    await connection.query('CREATE DATABASE IF NOT EXISTS traderdb');
    console.log('✅ Database "traderdb" ensured.');

    await connection.query('USE traderdb');

    const sqlPath = path.join(__dirname, 'traderdb.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    // Split SQL into individual statements
    // This is a simple split, might not work for complex SQL with procedures
    const statements = sql
      .split(/;\s*$/m)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    console.log(`⏳ Executing ${statements.length} SQL statements...`);

    for (let statement of statements) {
      try {
        await connection.query(statement);
      } catch (err) {
        if (err.code === 'ER_TABLE_EXISTS_ERROR') {
          // Ignore table exists errors
        } else {
          console.error(`❌ Error executing statement: ${statement.substring(0, 50)}...`);
          console.error(err.message);
        }
      }
    }

    console.log('✅ Database schema imported successfully.');

    // Seed users
    const users = [
      ['superadmin', '$2a$10$mC7G5YvJ8H.4pX.L3.zFe.6D9f1v8Z7J8J8J8J8J8J8J8J8J8J8J8', 'Super Admin User', 'SUPERADMIN'],
      ['admin', '$2a$10$mC7G5YvJ8H.4pX.L3.zFe.6D9f1v8Z7J8J8J8J8J8J8J8J8J8J8J8', 'Project Admin', 'ADMIN'],
      ['broker', '$2a$10$mC7G5YvJ8H.4pX.L3.zFe.6D9f1v8Z7J8J8J8J8J8J8J8J8J8J8J8', 'Main Broker', 'BROKER'],
      ['trader', '$2a$10$mC7G5YvJ8H.4pX.L3.zFe.6D9f1v8Z7J8J8J8J8J8J8J8J8J8J8J8', 'Test Trader', 'TRADER']
    ];

    console.log('🌱 Seeding dummy users...');
    for (const user of users) {
      try {
        await connection.execute(
          'INSERT INTO users (username, password, full_name, role, status) VALUES (?, ?, ?, ?, "Active")',
          user
        );
        console.log(`✅ Created user: ${user[0]} (${user[3]})`);
      } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
          console.log(`⚠️  User ${user[0]} already exists.`);
        } else {
          console.error(`❌ Failed to seed user ${user[0]}:`, err.message);
        }
      }
    }

    // Seed scrips
    const sampleScrips = [
      { symbol: 'CRUDEOIL', lot_size: 1, margin_req: 50000 },
      { symbol: 'GOLD', lot_size: 1, margin_req: 100000 },
      { symbol: 'SILVER', lot_size: 1, margin_req: 80000 },
      { symbol: 'NIFTY', lot_size: 50, margin_req: 150000 },
      { symbol: 'BANKNIFTY', lot_size: 25, margin_req: 130000 },
      { symbol: 'RELIANCE', lot_size: 250, margin_req: 200000 },
      { symbol: 'TCS', lot_size: 175, margin_req: 210000 },
      { symbol: 'HDFCBANK', lot_size: 550, margin_req: 180000 }
    ];

    console.log('Seeding scrip_data...');
    for (const scrip of sampleScrips) {
      try {
        await connection.execute(
          'INSERT IGNORE INTO scrip_data (symbol, lot_size, margin_req, status) VALUES (?, ?, ?, ?)',
          [scrip.symbol, scrip.lot_size, scrip.margin_req, 'OPEN']
        );
      } catch (err) {
        console.error(`❌ Failed to seed scrip ${scrip.symbol}:`, err.message);
      }
    }
    console.log('✅ Scrip seeding complete!');

    await connection.end();
  } catch (err) {
    console.error('❌ Setup failed:', err.message);
  }
}

setupDatabase();
