const mysql = require('mysql2/promise');
require('dotenv').config();

async function fixParentIds() {
  const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'traderdb',
    port: parseInt(process.env.DB_PORT || '3306')
  };

  try {
    const connection = await mysql.createConnection(dbConfig);
    
    // Get SUPERADMIN ID
    const [superAdmins] = await connection.execute('SELECT id FROM users WHERE role = "SUPERADMIN" LIMIT 1');
    if (superAdmins.length === 0) {
      console.log('No SUPERADMIN found!');
      await connection.end();
      return;
    }
    
    const superAdminId = superAdmins[0].id;
    console.log(`\nSUPERADMIN ID: ${superAdminId}`);
    
    // Find TRADERs with NULL or 0 parent_id or wrong parent_id
    const [problematicTraders] = await connection.execute(
      'SELECT id, username, parent_id FROM users WHERE role = "TRADER" AND (parent_id IS NULL OR parent_id = 0 OR parent_id NOT IN (SELECT id FROM users))'
    );
    
    console.log(`\nFound ${problematicTraders.length} TRADERS with invalid parent_id:`);
    console.log(JSON.stringify(problematicTraders, null, 2));
    
    if (problematicTraders.length > 0) {
      console.log(`\n🔧 FIXING: Setting parent_id to SUPERADMIN (${superAdminId}) for all problematic TRADERs...`);
      const [result] = await connection.execute(
        'UPDATE users SET parent_id = ? WHERE role = "TRADER" AND (parent_id IS NULL OR parent_id = 0 OR parent_id NOT IN (SELECT id FROM users))',
        [superAdminId]
      );
      console.log(`✅ Updated ${result.changedRows} TRADERs`);
    }
    
    // Show final state
    const [finalTraders] = await connection.execute('SELECT id, username, parent_id FROM users WHERE role = "TRADER"');
    console.log('\n=== FINAL STATE ===');
    console.log(JSON.stringify(finalTraders, null, 2));
    
    await connection.end();
  } catch (err) {
    console.error('Error:', err.message);
  }
}

fixParentIds();
