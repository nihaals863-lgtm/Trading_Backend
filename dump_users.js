const db = require('./src/config/db');

async function dump() {
    const [create] = await db.execute('SHOW CREATE TABLE users');
    console.log('--- CREATE TABLE ---');
    console.log(create[0]['Create Table']);
    
    const [users] = await db.execute('SELECT * FROM users');
    console.log('\n--- USERS DATA ---');
    users.forEach(u => {
        delete u.password; // Don't print hashes
        delete u.transaction_password;
        console.log(JSON.stringify(u));
    });
    process.exit();
}

dump();
