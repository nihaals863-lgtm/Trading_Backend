const db = require('./src/config/db');
const bcrypt = require('bcryptjs');

async function resetAdminPassword() {
    try {
        const usersToReset = [
            { username: 'superadmin', password: 'superadmin123' },
            { username: 'admin',      password: 'admin123'      },
            { username: 'broker',     password: 'broker123'     }
        ];

        for (const user of usersToReset) {
            const hashedPassword = await bcrypt.hash(user.password, 10);
            const [result] = await db.execute(
                'UPDATE users SET password = ? WHERE username = ?',
                [hashedPassword, user.username]
            );

            if (result.affectedRows > 0) {
                console.log(`✅ Password for "${user.username}" has been reset to "${user.password}"`);
            } else {
                console.log(`❌ User "${user.username}" not found.`);
            }
        }
        process.exit();
    } catch (err) {
        console.error('❌ Error updating password:', err.message);
        process.exit(1);
    }
}

resetAdminPassword();
