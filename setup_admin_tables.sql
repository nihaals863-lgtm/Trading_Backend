-- ============================================================
-- Run this SQL against your MySQL database ONCE to enable:
--   1. Admin menu permissions
--   2. Theme settings
--   3. System settings (logo path)
-- ============================================================

-- 1. Admin menu permissions table
CREATE TABLE IF NOT EXISTS admin_menu_permissions (
    id       INT AUTO_INCREMENT PRIMARY KEY,
    user_id  INT         NOT NULL,
    menu_id  VARCHAR(100) NOT NULL,
    UNIQUE KEY uq_user_menu (user_id, menu_id),
    CONSTRAINT fk_amp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 2. Theme settings table (key-value, one row per CSS variable)
CREATE TABLE IF NOT EXISTS theme_settings (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    setting_key   VARCHAR(100) NOT NULL UNIQUE,
    setting_value VARCHAR(200) NOT NULL,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 3. Generic system settings table (logo_path
CREATE TABLE IF NOT EXISTS system_settings (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    setting_key   VARCHAR(100) NOT NULL UNIQUE,
    setting_value TEXT,
    updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Default theme values (safe to run multiple times — uses INSERT IGNORE)
INSERT IGNORE INTO theme_settings (setting_key, setting_value) VALUES
    ('sidebarColor',    '#1a2035'),
    ('navbarColor',     '#288c6c'),
    ('primaryColor',    '#4ea752'),
    ('buttonColor',     '#4CAF50'),
    ('backgroundColor', '#1a2035'),
    ('textColor',       '#ffffff');
