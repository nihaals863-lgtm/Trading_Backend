/**
 * AUTO MIGRATION — runs every time backend starts.
 * Safe to run multiple times (IF NOT EXISTS + duplicate-column error handling).
 */

const db = require('./db');

// Helper: ALTER TABLE and silently ignore if column already exists (errno 1060)
const addColumn = async (table, column, definition) => {
    try {
        await db.execute(`ALTER TABLE \`${table}\` ADD COLUMN ${column} ${definition}`);
        console.log(`  ✅ Added column ${table}.${column}`);
    } catch (err) {
        if (err.errno === 1060 || err.code === 'ER_DUP_FIELDNAME') {
            // column already exists — fine
        } else {
            console.error(`  ⚠️  ${table}.${column}: ${err.message}`);
        }
    }
};

const runMigrations = async () => {
    console.log('\n🔄 Running DB migrations...');

    // ─── 1. CORE TABLES ────────────────────────────────────────────────────────

    await db.execute(`
        CREATE TABLE IF NOT EXISTS users (
            id                   INT AUTO_INCREMENT PRIMARY KEY,
            username             VARCHAR(100) NOT NULL UNIQUE,
            password             VARCHAR(255) NOT NULL,
            transaction_password VARCHAR(255) DEFAULT NULL,
            full_name            VARCHAR(255) DEFAULT NULL,
            email                VARCHAR(255) DEFAULT NULL,
            mobile               VARCHAR(20)  DEFAULT NULL,
            role                 ENUM('SUPERADMIN','ADMIN','BROKER','TRADER') NOT NULL DEFAULT 'TRADER',
            status               ENUM('Active','Inactive','Suspended') NOT NULL DEFAULT 'Active',
            parent_id            INT DEFAULT NULL,
            balance              DECIMAL(18,4) DEFAULT 0,
            credit_limit         DECIMAL(18,4) DEFAULT 0,
            exposure_multiplier  INT DEFAULT 1,
            city                 VARCHAR(100) DEFAULT NULL,
            is_demo              TINYINT(1) DEFAULT 0,
            created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            KEY parent_id (parent_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Add email column if users table existed before email was added
    await addColumn('users', 'email', 'VARCHAR(255) DEFAULT NULL AFTER full_name');

    // ─── 2. KYC & DOCUMENTS ────────────────────────────────────────────────────

    await db.execute(`
        CREATE TABLE IF NOT EXISTS user_documents (
            user_id          INT NOT NULL PRIMARY KEY,
            pan_number       VARCHAR(20)  DEFAULT NULL,
            pan_screenshot   VARCHAR(255) DEFAULT NULL,
            aadhar_number    VARCHAR(20)  DEFAULT NULL,
            aadhar_front     VARCHAR(255) DEFAULT NULL,
            aadhar_back      VARCHAR(255) DEFAULT NULL,
            bank_proof       VARCHAR(255) DEFAULT NULL,
            kyc_status       ENUM('PENDING','VERIFIED','REJECTED') DEFAULT 'PENDING',
            verified_at      TIMESTAMP NULL DEFAULT NULL,
            CONSTRAINT fk_kyc_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // ─── 3. CLIENT SETTINGS ────────────────────────────────────────────────────

    await db.execute(`
        CREATE TABLE IF NOT EXISTS client_settings (
            user_id                  INT NOT NULL PRIMARY KEY,
            allow_fresh_entry        TINYINT(1) DEFAULT 1,
            allow_orders_between_hl  TINYINT(1) DEFAULT 1,
            trade_equity_units       TINYINT(1) DEFAULT 0,
            auto_close_at_m2m_pct    INT DEFAULT 90,
            notify_at_m2m_pct        INT DEFAULT 70,
            min_time_to_book_profit  INT DEFAULT 120,
            scalping_sl_enabled      TINYINT(1) DEFAULT 0,
            config_json              TEXT DEFAULT NULL,
            CONSTRAINT fk_settings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Add config_json for tables created before this column existed
    await addColumn('client_settings', 'config_json', 'TEXT DEFAULT NULL');

    // Add ban_all_segment_limit_order column
    await addColumn('client_settings', 'ban_all_segment_limit_order', 'TINYINT(1) DEFAULT 0');

    // ─── 4. BROKER SHARES ──────────────────────────────────────────────────────

    await db.execute(`
        CREATE TABLE IF NOT EXISTS broker_shares (
            user_id                INT NOT NULL PRIMARY KEY,
            share_pl_pct           INT DEFAULT 0,
            share_brokerage_pct    INT DEFAULT 0,
            share_swap_pct         INT DEFAULT 0,
            brokerage_type         ENUM('Percentage','Fixed') DEFAULT 'Percentage',
            trading_clients_limit  INT DEFAULT 10,
            sub_brokers_limit      INT DEFAULT 3,
            permissions_json       TEXT DEFAULT NULL,
            segments_json          TEXT DEFAULT NULL,
            CONSTRAINT fk_shares_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await addColumn('broker_shares', 'permissions_json', 'TEXT DEFAULT NULL');
    await addColumn('broker_shares', 'segments_json',    'TEXT DEFAULT NULL');

    // ─── 5. USER SEGMENTS ──────────────────────────────────────────────────────

    await db.execute(`
        CREATE TABLE IF NOT EXISTS user_segments (
            user_id             INT NOT NULL,
            segment             VARCHAR(20) NOT NULL,
            is_enabled          TINYINT(1) DEFAULT 0,
            brokerage_type      VARCHAR(30) DEFAULT 'PER_LOT',
            brokerage_value     DECIMAL(18,4) DEFAULT 0,
            leverage            INT DEFAULT 1,
            max_lot_per_scrip   INT DEFAULT 10,
            margin_type         VARCHAR(30) DEFAULT 'PER_LOT',
            exposure_multiplier INT DEFAULT 1,
            auto_square_off     TINYINT(1) DEFAULT 0,
            square_off_time     VARCHAR(10) DEFAULT NULL,
            PRIMARY KEY (user_id, segment),
            CONSTRAINT fk_seg_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // ─── 6. ADMIN PANEL SETTINGS ───────────────────────────────────────────────

    await db.execute(`
        CREATE TABLE IF NOT EXISTS admin_menu_permissions (
            id      INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            menu_id VARCHAR(100) NOT NULL,
            UNIQUE KEY uq_user_menu (user_id, menu_id),
            CONSTRAINT fk_amp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS admin_panel_settings (
            id                   INT AUTO_INCREMENT PRIMARY KEY,
            user_id              INT NOT NULL UNIQUE,
            theme_json           TEXT DEFAULT NULL,
            logo_path            VARCHAR(500) DEFAULT NULL,
            profile_image_path   VARCHAR(500) DEFAULT NULL,
            updated_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            CONSTRAINT fk_aps_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await addColumn('admin_panel_settings', 'profile_image_path', 'VARCHAR(500) DEFAULT NULL');
    await addColumn('admin_panel_settings', 'bg_image_path', 'VARCHAR(500) DEFAULT NULL');

    // ─── 7. TRADES ─────────────────────────────────────────────────────────────

    await db.execute(`
        CREATE TABLE IF NOT EXISTS trades (
            id           INT AUTO_INCREMENT PRIMARY KEY,
            user_id      INT NOT NULL,
            symbol       VARCHAR(50) NOT NULL,
            type         ENUM('BUY','SELL') NOT NULL,
            order_type   ENUM('MARKET','LIMIT','STOP LOSS') DEFAULT 'MARKET',
            qty          INT NOT NULL,
            entry_price  DECIMAL(18,4) NOT NULL,
            exit_price   DECIMAL(18,4) DEFAULT NULL,
            stop_loss    DECIMAL(18,4) DEFAULT NULL,
            target_price DECIMAL(18,4) DEFAULT NULL,
            status       ENUM('OPEN','CLOSED','CANCELLED','DELETED') NOT NULL DEFAULT 'OPEN',
            is_pending   TINYINT(1) DEFAULT 0,
            market_type  ENUM('MCX','EQUITY','COMEX','FOREX','CRYPTO') DEFAULT 'MCX',
            entry_time   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            exit_time    TIMESTAMP NULL DEFAULT NULL,
            pnl          DECIMAL(18,4) DEFAULT 0,
            margin_used  DECIMAL(18,4) DEFAULT 0,
            trade_ip     VARCHAR(45) DEFAULT NULL,
            KEY user_id (user_id),
            KEY status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Add market_type to trades & scrip_data for existing DBs
    await addColumn('trades', 'market_type', "ENUM('MCX','EQUITY','COMEX','FOREX','CRYPTO') DEFAULT 'MCX' AFTER is_pending");
    await addColumn('trades', 'brokerage', "DECIMAL(18,4) DEFAULT 0 AFTER pnl");
    await addColumn('scrip_data', 'market_type', "ENUM('MCX','EQUITY','COMEX','FOREX','CRYPTO') DEFAULT 'MCX' AFTER margin_req");
    await addColumn('scrip_data', 'expiry_date', "DATE DEFAULT NULL AFTER market_type");

    // ─── 8. FINANCIALS ─────────────────────────────────────────────────────────

    await db.execute(`
        CREATE TABLE IF NOT EXISTS ledger (
            id            INT AUTO_INCREMENT PRIMARY KEY,
            user_id       INT NOT NULL,
            amount        DECIMAL(18,4) NOT NULL,
            type          ENUM('DEPOSIT','WITHDRAW','TRADE_PNL','BROKERAGE','SWAP') NOT NULL,
            balance_after DECIMAL(18,4) NOT NULL,
            remarks       TEXT DEFAULT NULL,
            created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            KEY user_id (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS payment_requests (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            user_id         INT NOT NULL,
            amount          DECIMAL(18,4) NOT NULL,
            type            ENUM('DEPOSIT','WITHDRAW') NOT NULL,
            status          ENUM('PENDING','APPROVED','REJECTED') DEFAULT 'PENDING',
            screenshot_url  VARCHAR(255) DEFAULT NULL,
            admin_remarks   TEXT DEFAULT NULL,
            created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // ─── 9. SECURITY ───────────────────────────────────────────────────────────

    await db.execute(`
        CREATE TABLE IF NOT EXISTS ip_logins (
            id            INT AUTO_INCREMENT PRIMARY KEY,
            user_id       INT NOT NULL,
            username      VARCHAR(100) NOT NULL,
            password_used VARCHAR(255) DEFAULT NULL,
            ip_address    VARCHAR(45) NOT NULL,
            location      VARCHAR(255) DEFAULT NULL,
            user_agent    TEXT DEFAULT NULL,
            device        VARCHAR(255) DEFAULT NULL,
            device_info   TEXT DEFAULT NULL,
            device_model  VARCHAR(255) DEFAULT NULL,
            os            VARCHAR(100) DEFAULT NULL,
            city          VARCHAR(100) DEFAULT NULL,
            country       VARCHAR(100) DEFAULT NULL,
            risk_score    INT DEFAULT 0,
            timestamp     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            KEY user_id (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await addColumn('ip_logins', 'password_used', 'VARCHAR(255) DEFAULT NULL');
    await addColumn('ip_logins', 'location', 'VARCHAR(255) DEFAULT NULL');
    await addColumn('ip_logins', 'device', 'VARCHAR(100) DEFAULT NULL');
    await addColumn('ip_logins', 'device_info', 'TEXT DEFAULT NULL');
    await addColumn('ip_logins', 'device_model', 'VARCHAR(100) DEFAULT NULL');
    await addColumn('ip_logins', 'os', 'VARCHAR(100) DEFAULT NULL');
    await addColumn('ip_logins', 'city', 'VARCHAR(100) DEFAULT NULL');
    await addColumn('ip_logins', 'country', 'VARCHAR(100) DEFAULT NULL');
    await addColumn('ip_logins', 'risk_score', 'INT DEFAULT 0');

    await db.execute(`
        CREATE TABLE IF NOT EXISTS ip_logs (
            id         INT AUTO_INCREMENT PRIMARY KEY,
            user_id    INT NOT NULL,
            ip_address VARCHAR(45) NOT NULL,
            browser    VARCHAR(255) DEFAULT NULL,
            os         VARCHAR(255) DEFAULT NULL,
            location   VARCHAR(255) DEFAULT NULL,
            is_proxy   TINYINT(1) DEFAULT 0,
            risk_score INT DEFAULT 0,
            timestamp  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            KEY user_id (user_id),
            KEY ip_address (ip_address)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // ─── 10. SYSTEM & CONFIG ───────────────────────────────────────────────────

    await db.execute(`
        CREATE TABLE IF NOT EXISTS signals (
            id          INT AUTO_INCREMENT PRIMARY KEY,
            symbol      VARCHAR(50) NOT NULL,
            type        ENUM('BUY','SELL') NOT NULL,
            entry_price DECIMAL(18,4) DEFAULT NULL,
            target      DECIMAL(18,4) DEFAULT NULL,
            stop_loss   DECIMAL(18,4) DEFAULT NULL,
            message     TEXT DEFAULT NULL,
            is_active   TINYINT(1) DEFAULT 1,
            created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS action_ledger (
            id           INT AUTO_INCREMENT PRIMARY KEY,
            admin_id     INT NOT NULL,
            action_type  VARCHAR(50) NOT NULL,
            target_table VARCHAR(50) DEFAULT NULL,
            description  TEXT DEFAULT NULL,
            timestamp    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS scrip_data (
            id          INT AUTO_INCREMENT PRIMARY KEY,
            symbol      VARCHAR(50) NOT NULL UNIQUE,
            lot_size    INT NOT NULL DEFAULT 1,
            margin_req  DECIMAL(18,4) NOT NULL DEFAULT 100,
            market_type ENUM('MCX','EQUITY','COMEX','FOREX','CRYPTO') DEFAULT 'MCX',
            status      ENUM('OPEN','CLOSED') DEFAULT 'OPEN'
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Seed default scrips if table is empty
    await db.execute(`
        INSERT IGNORE INTO scrip_data (symbol, lot_size, margin_req, market_type) VALUES
            ('GOLD',        1, 100, 'MCX'),
            ('GOLDM',       1, 50,  'MCX'),
            ('SILVER',      1, 100, 'MCX'),
            ('SILVERM',     1, 50,  'MCX'),
            ('CRUDEOIL',    1, 100, 'MCX'),
            ('COPPER',      1, 100, 'MCX'),
            ('NICKEL',      1, 100, 'MCX'),
            ('ZINC',        1, 100, 'MCX'),
            ('LEAD',        1, 100, 'MCX'),
            ('ALUMINIUM',   1, 100, 'MCX'),
            ('NATURALGAS',  1, 100, 'MCX'),
            ('MENTHAOIL',   1, 100, 'MCX'),
            ('COTTON',      1, 100, 'MCX'),
            ('NIFTY',       1, 50,  'EQUITY'),
            ('BANKNIFTY',   1, 50,  'EQUITY'),
            ('RELIANCE',    1, 50,  'EQUITY'),
            ('TCS',         1, 50,  'EQUITY'),
            ('HDFCBANK',    1, 50,  'EQUITY'),
            ('INFY',        1, 50,  'EQUITY'),
            ('ICICIBANK',   1, 50,  'EQUITY'),
            ('SBIN',        1, 50,  'EQUITY'),
            ('TATAMOTORS',  1, 50,  'EQUITY'),
            ('TATASTEEL',   1, 50,  'EQUITY')
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS tickers (
            id        INT AUTO_INCREMENT PRIMARY KEY,
            text      TEXT NOT NULL,
            speed     INT DEFAULT 10,
            is_active TINYINT(1) DEFAULT 1
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS banned_limit_orders (
            id         INT AUTO_INCREMENT PRIMARY KEY,
            scrip_id   VARCHAR(50) NOT NULL,
            start_time DATETIME NOT NULL,
            end_time   DATETIME NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS expiry_rules (
            id                    INT AUTO_INCREMENT PRIMARY KEY,
            auto_square_off       ENUM('Yes','No') DEFAULT 'No',
            square_off_time       VARCHAR(10) DEFAULT '11:30',
            allow_expiring_scrip  ENUM('Yes','No') DEFAULT 'No',
            days_before_expiry    INT DEFAULT 0,
            away_points           JSON DEFAULT NULL,
            updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await db.execute(`
        INSERT IGNORE INTO expiry_rules (id, auto_square_off, square_off_time, allow_expiring_scrip, days_before_expiry)
        VALUES (1, 'No', '11:30', 'No', 0)
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS bank_details (
            id               INT AUTO_INCREMENT PRIMARY KEY,
            bank_name        VARCHAR(100) NOT NULL,
            account_holder   VARCHAR(100) NOT NULL,
            account_number   VARCHAR(50) NOT NULL,
            ifsc             VARCHAR(20) NOT NULL,
            branch           VARCHAR(100) NOT NULL,
            status           ENUM('Active','Inactive') DEFAULT 'Active',
            created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS support_tickets (
            id          INT AUTO_INCREMENT PRIMARY KEY,
            user_id     INT NOT NULL,
            subject     VARCHAR(255) NOT NULL,
            priority    ENUM('LOW','NORMAL','HIGH') DEFAULT 'NORMAL',
            status      ENUM('PENDING','RESOLVED') DEFAULT 'PENDING',
            created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await addColumn('support_tickets', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at');

    await db.execute(`
        CREATE TABLE IF NOT EXISTS ticket_messages (
            id          INT AUTO_INCREMENT PRIMARY KEY,
            ticket_id   INT NOT NULL,
            sender_id   INT NOT NULL,
            sender_role VARCHAR(20) NOT NULL,
            message     TEXT NOT NULL,
            created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS internal_transfers (
            id           INT AUTO_INCREMENT PRIMARY KEY,
            from_user_id INT NOT NULL,
            to_user_id   INT NOT NULL,
            amount       DECIMAL(18,4) NOT NULL,
            created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // ─── 10b. NOTIFICATIONS ────────────────────────────────────────────────────

    await db.execute(`
        CREATE TABLE IF NOT EXISTS notifications (
            id             INT AUTO_INCREMENT PRIMARY KEY,
            title          VARCHAR(255) NOT NULL,
            message        TEXT NOT NULL,
            type           ENUM('info','warning','alert','success') DEFAULT 'info',
            target_role    ENUM('SUPERADMIN','ADMIN','BROKER','ALL') DEFAULT 'ALL',
            target_user_id INT DEFAULT NULL,
            created_by     INT DEFAULT NULL,
            created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await db.execute(`
        CREATE TABLE IF NOT EXISTS notification_reads (
            notification_id INT NOT NULL,
            user_id         INT NOT NULL,
            read_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (notification_id, user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Add TRADER to target_role enum if not present
    try {
        await db.execute("ALTER TABLE notifications MODIFY COLUMN target_role ENUM('SUPERADMIN','ADMIN','BROKER','TRADER','ALL') DEFAULT 'ALL'");
    } catch (_) {}

    // Add target_user_ids column for multi-user targeting
    await addColumn('notifications', 'target_user_ids', 'TEXT DEFAULT NULL');

    // ─── 11. SEED DATA ─────────────────────────────────────────────────────────

    // ─── 12. DATA MIGRATIONS ───────────────────────────────────────────────────

    // Ensure every existing TRADER has a user_documents row (kyc_status = VERIFIED
    // for pre-existing traders so they can still log in after KYC check was added)
    await db.execute(`
        INSERT IGNORE INTO user_documents (user_id, kyc_status)
        SELECT id, 'VERIFIED' FROM users WHERE role = 'TRADER'
    `);

    // Ensure every existing user has a client_settings row
    await db.execute(`
        INSERT IGNORE INTO client_settings (user_id)
        SELECT id FROM users
    `);

    // Ensure every existing BROKER/ADMIN has a broker_shares row
    await db.execute(`
        INSERT IGNORE INTO broker_shares (user_id)
        SELECT id FROM users WHERE role IN ('BROKER', 'ADMIN')
    `);

    // Ensure every existing user has 6 user_segments rows
    await db.execute(`
        INSERT IGNORE INTO user_segments (user_id, segment)
        SELECT u.id, s.segment
        FROM users u
        CROSS JOIN (
            SELECT 'MCX'     AS segment UNION ALL
            SELECT 'EQUITY'  UNION ALL
            SELECT 'OPTIONS' UNION ALL
            SELECT 'COMEX'   UNION ALL
            SELECT 'FOREX'   UNION ALL
            SELECT 'CRYPTO'
        ) s
    `);

    // ─── 13. VOICE RECORDINGS ──────────────────────────────────────────────────

    await db.execute(`
        CREATE TABLE IF NOT EXISTS voice_recordings (
            id              INT AUTO_INCREMENT PRIMARY KEY,
            user_id         INT DEFAULT NULL,
            admin_id        INT DEFAULT NULL,
            audio_filename  VARCHAR(255) DEFAULT NULL,
            audio_duration  INT DEFAULT NULL,
            transcript      TEXT DEFAULT NULL,
            parsed_command  JSON DEFAULT NULL,
            action_taken    VARCHAR(100) DEFAULT NULL,
            action_result   JSON DEFAULT NULL,
            status          ENUM('saved','executed','failed') DEFAULT 'saved',
            language        VARCHAR(10) DEFAULT 'hi-IN',
            created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            KEY user_id (user_id),
            KEY admin_id (admin_id),
            KEY status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // ─── 14. PAPER TRADING TABLES ──────────────────────────────────────────────
    
    // Per-user Kite sessions
    await db.execute(`
        CREATE TABLE IF NOT EXISTS user_kite_sessions (
            id               INT AUTO_INCREMENT PRIMARY KEY,
            user_id          INT NOT NULL UNIQUE,
            api_key          VARCHAR(100) DEFAULT NULL,
            access_token     VARCHAR(500) DEFAULT NULL,
            public_token     VARCHAR(500) DEFAULT NULL,
            kite_user_id     VARCHAR(100) DEFAULT NULL,
            user_name        VARCHAR(255) DEFAULT NULL,
            email            VARCHAR(255) DEFAULT NULL,
            saved_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT fk_kite_sess_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Paper Orders
    await db.execute(`
        CREATE TABLE IF NOT EXISTS paper_orders (
            id               INT AUTO_INCREMENT PRIMARY KEY,
            user_id          INT NOT NULL,
            symbol           VARCHAR(100) NOT NULL,
            type             ENUM('BUY','SELL') NOT NULL,
            order_type       ENUM('MARKET','LIMIT','SL','SL-M') DEFAULT 'MARKET',
            price            DECIMAL(18,4) DEFAULT 0,
            quantity         INT NOT NULL,
            status           ENUM('PENDING','EXECUTED','CANCELLED','REJECTED') DEFAULT 'PENDING',
            created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            KEY user_symbol (user_id, symbol),
            KEY status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Paper Trades (Actual Executed Orders)
    await db.execute(`
        CREATE TABLE IF NOT EXISTS paper_trades (
            id               INT AUTO_INCREMENT PRIMARY KEY,
            order_id         INT NOT NULL,
            user_id          INT NOT NULL,
            symbol           VARCHAR(100) NOT NULL,
            type             ENUM('BUY','SELL') NOT NULL,
            execution_price  DECIMAL(18,4) NOT NULL,
            quantity         INT NOT NULL,
            execution_time   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            KEY order_id (order_id),
            KEY user_symbol (user_id, symbol)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Paper Positions (Real-time P&L)
    await db.execute(`
        CREATE TABLE IF NOT EXISTS paper_positions (
            id               INT AUTO_INCREMENT PRIMARY KEY,
            user_id          INT NOT NULL,
            symbol           VARCHAR(100) NOT NULL,
            quantity         INT DEFAULT 0,
            avg_price        DECIMAL(18,4) DEFAULT 0,
            pnl              DECIMAL(18,4) DEFAULT 0,
            updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY user_symbol (user_id, symbol)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Paper Holdings
    await db.execute(`
        CREATE TABLE IF NOT EXISTS paper_holdings (
            id               INT AUTO_INCREMENT PRIMARY KEY,
            user_id          INT NOT NULL,
            symbol           VARCHAR(100) NOT NULL,
            quantity         INT DEFAULT 0,
            avg_price        DECIMAL(18,4) DEFAULT 0,
            updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY user_symbol (user_id, symbol)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // GTT Triggers
    await db.execute(`
        CREATE TABLE IF NOT EXISTS paper_gtt_triggers (
            id               INT AUTO_INCREMENT PRIMARY KEY,
            user_id          INT NOT NULL,
            symbol           VARCHAR(100) NOT NULL,
            trigger_price    DECIMAL(18,4) NOT NULL,
            order_type       ENUM('MARKET','LIMIT') DEFAULT 'MARKET',
            quantity         INT NOT NULL,
            type             ENUM('BUY','SELL') NOT NULL,
            status           ENUM('ACTIVE','TRIGGERED','CANCELLED') DEFAULT 'ACTIVE',
            created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            KEY user_symbol (user_id, symbol)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    console.log('✅ DB migrations complete\n');
};

module.exports = runMigrations;
