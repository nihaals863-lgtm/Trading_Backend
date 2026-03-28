-- TRADERS PROJECT: COMPLETE DATABASE SCHEMA
-- Target: PHPMyAdmin / MySQL

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";

-- --------------------------------------------------------
-- 1. USERS & HIERARCHY
-- --------------------------------------------------------

CREATE TABLE `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(100) NOT NULL,
  `password` varchar(255) NOT NULL,
  `transaction_password` varchar(255) DEFAULT NULL,
  `full_name` varchar(255) NOT NULL,
  `mobile` varchar(20) DEFAULT NULL,
  `role` enum('SUPERADMIN','ADMIN','BROKER','TRADER') NOT NULL DEFAULT 'TRADER',
  `status` enum('Active','Inactive','Suspended') NOT NULL DEFAULT 'Active',
  `parent_id` int(11) DEFAULT NULL,
  `balance` decimal(18,4) DEFAULT '0.0000',
  `credit_limit` decimal(18,4) DEFAULT '0.0000',
  `exposure_multiplier` int(11) DEFAULT '1',
  `city` varchar(100) DEFAULT NULL,
  `is_demo` tinyint(1) DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  KEY `parent_id` (`parent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------------------------
-- 1.1 KYC & DOCUMENTS
-- --------------------------------------------------------

CREATE TABLE `user_documents` (
  `user_id` int(11) NOT NULL,
  `pan_number` varchar(20) DEFAULT NULL,
  `pan_screenshot` varchar(255) DEFAULT NULL,
  `aadhar_number` varchar(20) DEFAULT NULL,
  `aadhar_front` varchar(255) DEFAULT NULL,
  `aadhar_back` varchar(255) DEFAULT NULL,
  `bank_proof` varchar(255) DEFAULT NULL,
  `kyc_status` enum('PENDING','VERIFIED','REJECTED') DEFAULT 'PENDING',
  `verified_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_kyc_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------------------------
-- 2. TRADING CONFIGURATIONS (Granular)
-- --------------------------------------------------------

CREATE TABLE `client_settings` (
  `user_id` int(11) NOT NULL,
  `allow_fresh_entry` tinyint(1) DEFAULT '1',
  `allow_orders_between_hl` tinyint(1) DEFAULT '1',
  `trade_equity_units` tinyint(1) DEFAULT '0',
  `auto_close_at_m2m_pct` int(11) DEFAULT '90',
  `notify_at_m2m_pct` int(11) DEFAULT '70',
  `min_time_to_book_profit` int(11) DEFAULT '120', -- in seconds
  `scalping_sl_enabled` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_settings_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `broker_shares` (
  `user_id` int(11) NOT NULL,
  `share_pl_pct` int(11) DEFAULT '0',
  `share_brokerage_pct` int(11) DEFAULT '0',
  `share_swap_pct` int(11) DEFAULT '0',
  `brokerage_type` enum('Percentage','Fixed') DEFAULT 'Percentage',
  `trading_clients_limit` int(11) DEFAULT '10',
  `sub_brokers_limit` int(11) DEFAULT '3',
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_shares_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------------------------
-- 3. TRADES & POSITIONS
-- --------------------------------------------------------

CREATE TABLE `trades` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `symbol` varchar(50) NOT NULL,
  `type` enum('BUY','SELL') NOT NULL,
  `order_type` enum('MARKET','LIMIT','STOP LOSS') DEFAULT 'MARKET',
  `qty` int(11) NOT NULL,
  `entry_price` decimal(18,4) NOT NULL,
  `exit_price` decimal(18,4) DEFAULT NULL,
  `stop_loss` decimal(18,4) DEFAULT NULL,
  `target_price` decimal(18,4) DEFAULT NULL,
  `status` enum('OPEN','CLOSED','CANCELLED','DELETED') NOT NULL DEFAULT 'OPEN',
  `is_pending` tinyint(1) DEFAULT '0',
  `entry_time` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `exit_time` timestamp NULL DEFAULT NULL,
  `pnl` decimal(18,4) DEFAULT '0.0000',
  `margin_used` decimal(18,4) DEFAULT '0.0000',
  `trade_ip` varchar(45) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  KEY `status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------------------------
-- 4. FINANCIALS
-- --------------------------------------------------------

CREATE TABLE `ledger` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `amount` decimal(18,4) NOT NULL,
  `type` enum('DEPOSIT','WITHDRAW','TRADE_PNL','BROKERAGE','SWAP') NOT NULL,
  `balance_after` decimal(18,4) NOT NULL,
  `remarks` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `payment_requests` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `amount` decimal(18,4) NOT NULL,
  `type` enum('DEPOSIT','WITHDRAW') NOT NULL,
  `status` enum('PENDING','APPROVED','REJECTED') DEFAULT 'PENDING',
  `screenshot_url` varchar(255) DEFAULT NULL,
  `admin_remarks` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------------------------
-- 5. SECURITY & SURVEILLANCE
-- --------------------------------------------------------

CREATE TABLE `ip_logs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `ip_address` varchar(45) NOT NULL,
  `browser` varchar(255) DEFAULT NULL,
  `os` varchar(255) DEFAULT NULL,
  `location` varchar(255) DEFAULT NULL,
  `is_proxy` tinyint(1) DEFAULT '0',
  `risk_score` int(11) DEFAULT '0',
  `timestamp` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  KEY `ip_address` (`ip_address`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `ip_logins` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `username` varchar(100) NOT NULL,
  `ip_address` varchar(45) NOT NULL,
  `user_agent` text DEFAULT NULL,
  `timestamp` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  CONSTRAINT `fk_ip_logins_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------------------------
-- 6. SYSTEM UTILS (Signals, Tickers, Batch)
-- --------------------------------------------------------

CREATE TABLE `signals` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `symbol` varchar(50) NOT NULL,
  `type` enum('BUY','SELL') NOT NULL,
  `entry_price` decimal(18,4) DEFAULT NULL,
  `target` decimal(18,4) DEFAULT NULL,
  `stop_loss` decimal(18,4) DEFAULT NULL,
  `message` text DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `action_ledger` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `admin_id` int(11) NOT NULL,
  `action_type` varchar(50) NOT NULL, -- SAVE, EDIT, DELETE
  `target_table` varchar(50) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `timestamp` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------------------------
-- 7. CONFIG & DATA (Scrips, Tickers)
-- --------------------------------------------------------

CREATE TABLE `scrip_data` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `symbol` varchar(50) NOT NULL,
  `lot_size` int(11) NOT NULL DEFAULT '1',
  `margin_req` decimal(18,4) NOT NULL DEFAULT '100.0000',
  `status` enum('OPEN','CLOSED') DEFAULT 'OPEN',
  PRIMARY KEY (`id`),
  UNIQUE KEY `symbol` (`symbol`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `tickers` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `text` text NOT NULL,
  `speed` int(11) DEFAULT '10',
  `is_active` tinyint(1) DEFAULT '1',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `support_tickets` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `subject` varchar(255) NOT NULL,
  `message` text NOT NULL,
  `admin_reply` text DEFAULT NULL,
  `priority` enum('LOW','NORMAL','HIGH') DEFAULT 'NORMAL',
  `status` enum('PENDING','RESOLVED') DEFAULT 'PENDING',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------------------------
-- 7.1 ADDITIONAL MODULES
-- --------------------------------------------------------

CREATE TABLE `internal_transfers` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `from_user_id` int(11) NOT NULL,
  `to_user_id` int(11) NOT NULL,
  `amount` decimal(18,4) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `global_configs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `config_key` varchar(100) NOT NULL,
  `config_value` text DEFAULT NULL,
  `module` varchar(50) DEFAULT 'SYSTEM',
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `config_key` (`config_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `learning_center` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title` varchar(255) NOT NULL,
  `content` longtext NOT NULL,
  `category` varchar(100) DEFAULT 'General',
  `video_url` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `ip_clusters` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `ip_address` varchar(45) NOT NULL,
  `user_count` int(11) DEFAULT '0',
  `status` enum('WATCH','BLOCKED','SAFE') DEFAULT 'WATCH',
  `last_detected` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ip_address` (`ip_address`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `forensic_logs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) NOT NULL,
  `event_type` varchar(50) NOT NULL,
  `severity` enum('INFO','LOW','MEDIUM','HIGH','CRITICAL') DEFAULT 'INFO',
  `details` text DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------------------------
-- 8. SEED DATA (INITIAL CONFIG)
-- --------------------------------------------------------

INSERT INTO `global_configs` (`config_key`, `config_value`, `module`) VALUES
('mcx_enabled', 'true', 'MARKET'),
('equity_enabled', 'true', 'MARKET'),
('options_enabled', 'true', 'MARKET'),
('maintenance_mode', 'false', 'SYSTEM'),
('auto_square_off_time', '23:30', 'RISK'),
('min_withdrawal_amount', '500', 'FINANCE');

COMMIT;
