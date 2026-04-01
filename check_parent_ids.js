const mysql = require('mysql2/promise');
require('dotenv').config();

async function checkParentIds() {
  const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'traderdb',
    port: parseInt(process.env.DB_PORT || '3306')
  };

  try {
    const connection = await mysql.createConnection(dbConfig);
    
    // Get SUPERADMIN info
    const [superAdmins] = await connection.execute('SELECT id, username, role FROM users WHERE role = "SUPERADMIN" LIMIT 1');
    console.log('\n=== SUPERADMIN ===');
    console.log(JSON.stringify(superAdmins, null, 2));
    
    if (superAdmins.length > 0) {
      const superAdminId = superAdmins[0].id;
      console.log(`\nSUPERADMIN ID: ${superAdminId}`);
      
      // Get clients created by SUPERADMIN (parent_id = superAdminId)
      const [clients] = await connection.execute(
        'SELECT id, username, role, parent_id FROM users WHERE parent_id = ? AND role = "TRADER"',
        [superAdminId]
      );
      console.log(`\nClients created by SUPERADMIN (parent_id=${superAdminId}):`);
      console.log(JSON.stringify(clients, null, 2));
    }
    
    // Show all TRADER users with their parent_ids
    const [allTraders] = await connection.execute('SELECT id, username, role, parent_id FROM users WHERE role = "TRADER" LIMIT 10');
    console.log('\n=== ALL TRADERS (showing parent_id) ===');
    console.log(JSON.stringify(allTraders, null, 2));
    
    await connection.end();
  } catch (err) {
    console.error('Error:', err.message);
  }
}

checkParentIds();
