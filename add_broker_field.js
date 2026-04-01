const mysql = require('mysql2/promise');
require('dotenv').config();

async function addBrokerField() {
  const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'traderdb',
    port: parseInt(process.env.DB_PORT || '3306')
  };

  try {
    const connection = await mysql.createConnection(dbConfig);
    
    console.log('Adding broker_id field to client_settings...');
    
    // Add broker_id column if it doesn't exist
    await connection.execute(`
      ALTER TABLE client_settings 
      ADD COLUMN broker_id INT DEFAULT NULL
    `);
    
    console.log('✅ broker_id field added to client_settings!');
    
    // Verify
    const [columns] = await connection.execute(`
      DESCRIBE client_settings
    `);
    
    console.log('\n=== client_settings columns ===');
    columns.forEach(col => {
      console.log(`${col.Field}: ${col.Type}`);
    });
    
    await connection.end();
  } catch (err) {
    if (err.message.includes('Duplicate column')) {
      console.log('✅ broker_id field already exists!');
    } else {
      console.error('Error:', err.message);
    }
  }
}

addBrokerField();
