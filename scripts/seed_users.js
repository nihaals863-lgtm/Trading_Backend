const db = require('../src/config/db');

const seedUsers = async () => {
    const users = [
        ['superadmin', '$2a$10$mC7G5YvJ8H.4pX.L3.zFe.6D9f1v8Z7J8J8J8J8J8J8J8J8J8J8J8', 'Super Admin User', 'SUPERADMIN'],
        ['admin', '$2a$10$mC7G5YvJ8H.4pX.L3.zFe.6D9f1v8Z7J8J8J8J8J8J8J8J8J8J8J8', 'Project Admin', 'ADMIN'],
        ['broker', '$2a$10$mC7G5YvJ8H.4pX.L3.zFe.6D9f1v8Z7J8J8J8J8J8J8J8J8J8J8J8', 'Main Broker', 'BROKER'],
        ['trader', '$2a$10$mC7G5YvJ8H.4pX.L3.zFe.6D9f1v8Z7J8J8J8J8J8J8J8J8J8J8J8', 'Test Trader', 'TRADER']
    ];

    try {
        console.log('🌱 Seeding dummy users...');
        for (const user of users) {
            try {
                await db.execute(
                    'INSERT INTO users (username, password, full_name, role, status) VALUES (?, ?, ?, ?, "Active")',
                    user
                );
                console.log(`✅ Created user: ${user[0]} (${user[3]})`);
            } catch (err) {
                if (err.code === 'ER_DUP_ENTRY') {
                    console.log(`⚠️  User ${user[0]} already exists.`);
                } else {
                    throw err;
                }
            }
        }
        console.log('✨ Seeding complete!');
    } catch (err) {
        console.error('❌ Seeding failed:', err.message);
    } finally {
        process.exit();
    }
};

seedUsers();
