const db = require('./src/config/db');
const bcrypt = require('bcryptjs');

const fixPasswords = async () => {
    try {
        const password = 'admin123';
        const hashedPassword = await bcrypt.hash(password, 10);

        console.log('Updating all test users with password: admin123');
        console.log('Hash:', hashedPassword);

        const users = ['superadmin', 'admin', 'broker', 'trader'];

        for (const username of users) {
            await db.execute('UPDATE users SET password = ? WHERE username = ?', [hashedPassword, username]);
            console.log(`✅ Updated ${username}`);
        }

        console.log('\n✨ All passwords updated! Try logging in with: admin123');
    } catch (err) {
        console.error('❌ Error:', err.message);
    } finally {
        process.exit();
    }
};

fixPasswords();
