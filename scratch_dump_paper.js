const db = require('./src/config/db');

async function dumpPaper() {
    try {
        const [pos] = await db.execute('SELECT * FROM paper_positions');
        const [holds] = await db.execute('SELECT * FROM paper_holdings');
        console.log('--- PAPER POSITIONS ---');
        console.log(JSON.stringify(pos, null, 2));
        console.log('--- PAPER HOLDINGS ---');
        console.log(JSON.stringify(holds, null, 2));
        console.log('--- END DUMP ---');
        process.exit(0);
    } catch (err) {
        console.error('Error dumping paper data:', err);
        process.exit(1);
    }
}

dumpPaper();
