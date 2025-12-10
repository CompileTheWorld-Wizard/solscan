-- PostgreSQL Schema for Solana Transaction Storage
-- Run this manually if you need to set up the database from scratch

-- Create the database (if needed)
-- CREATE DATABASE solscan;

-- Create the transactions table
CREATE TABLE IF NOT EXISTS tbl_solscan_transactions (
    id SERIAL PRIMARY KEY,
    transaction_id VARCHAR(100) UNIQUE NOT NULL,
    platform VARCHAR(50) NOT NULL,
    type VARCHAR(20) NOT NULL,
    mint_from VARCHAR(100) NOT NULL,
    mint_to VARCHAR(100) NOT NULL,
    in_amount NUMERIC(40, 0) NOT NULL,
    out_amount NUMERIC(40, 0) NOT NULL,
    fee_payer VARCHAR(100) NOT NULL,
    tip_amount NUMERIC(20, 9),
    fee_amount NUMERIC(20, 9),
    market_cap NUMERIC(20, 2),
    total_supply NUMERIC(40, 0),
    token_price_sol NUMERIC(20, 9),
    token_price_usd NUMERIC(20, 9),
    block_number BIGINT,
    block_timestamp TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_transaction_id ON tbl_solscan_transactions(transaction_id);
CREATE INDEX IF NOT EXISTS idx_platform ON tbl_solscan_transactions(platform);
CREATE INDEX IF NOT EXISTS idx_created_at ON tbl_solscan_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_fee_payer ON tbl_solscan_transactions(fee_payer);
CREATE INDEX IF NOT EXISTS idx_block_number ON tbl_solscan_transactions(block_number);
CREATE INDEX IF NOT EXISTS idx_block_timestamp ON tbl_solscan_transactions(block_timestamp);

-- Create the tokens table for storing token creator and first buy info
CREATE TABLE IF NOT EXISTS tbl_solscan_tokens (
    id SERIAL PRIMARY KEY,
    mint_address VARCHAR(100) UNIQUE NOT NULL,
    creator VARCHAR(100),
    dev_buy_amount VARCHAR(100),
    dev_buy_amount_decimal INTEGER,
    dev_buy_used_token VARCHAR(100),
    dev_buy_token_amount VARCHAR(100),
    dev_buy_token_amount_decimal INTEGER,
    dev_buy_timestamp TIMESTAMP,
    dev_buy_block_number BIGINT,
    token_name VARCHAR(200),
    symbol VARCHAR(50),
    image TEXT,
    twitter TEXT,
    website TEXT,
    discord TEXT,
    telegram TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for tokens table
CREATE INDEX IF NOT EXISTS idx_mint_address ON tbl_solscan_tokens(mint_address);
CREATE INDEX IF NOT EXISTS idx_creator ON tbl_solscan_tokens(creator);
CREATE INDEX IF NOT EXISTS idx_tokens_created_at ON tbl_solscan_tokens(created_at);
CREATE INDEX IF NOT EXISTS idx_dev_buy_timestamp ON tbl_solscan_tokens(dev_buy_timestamp);
CREATE INDEX IF NOT EXISTS idx_dev_buy_block_number ON tbl_solscan_tokens(dev_buy_block_number);

-- Create the skip_tokens table for tokens to skip when analyzing
CREATE TABLE IF NOT EXISTS tbl_solscan_skip_tokens (
    id SERIAL PRIMARY KEY,
    mint_address VARCHAR(100) UNIQUE NOT NULL,
    symbol VARCHAR(50),
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for skip_tokens table
CREATE INDEX IF NOT EXISTS idx_skip_mint_address ON tbl_solscan_skip_tokens(mint_address);

-- Create the wallets table for tracking wallet-token pairs
CREATE TABLE IF NOT EXISTS tbl_solscan_wallets (
    id SERIAL PRIMARY KEY,
    wallet_address VARCHAR(100) NOT NULL,
    token_address VARCHAR(100) NOT NULL,
    first_buy_timestamp TIMESTAMP,
    first_buy_amount VARCHAR(100),
    first_buy_mcap NUMERIC(20, 2),
    first_buy_supply VARCHAR(100),
    first_buy_price NUMERIC(20, 8),
    first_sell_timestamp TIMESTAMP,
    first_sell_amount VARCHAR(100),
    first_sell_mcap NUMERIC(20, 2),
    first_sell_supply VARCHAR(100),
    first_sell_price NUMERIC(20, 8),
    peak_buy_to_sell_price_sol NUMERIC(20, 9),
    peak_buy_to_sell_price_usd NUMERIC(20, 9),
    peak_buy_to_sell_mcap NUMERIC(20, 2),
    peak_sell_to_end_price_sol NUMERIC(20, 9),
    peak_sell_to_end_price_usd NUMERIC(20, 9),
    peak_sell_to_end_mcap NUMERIC(20, 2),
    buys_before_first_sell INTEGER DEFAULT 0,
    buys_after_first_sell INTEGER DEFAULT 0,
    price_timeseries JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(wallet_address, token_address)
);

-- Create indexes for wallets table
CREATE INDEX IF NOT EXISTS idx_wallet_address ON tbl_solscan_wallets(wallet_address);
CREATE INDEX IF NOT EXISTS idx_token_address ON tbl_solscan_wallets(token_address);
CREATE INDEX IF NOT EXISTS idx_wallet_token ON tbl_solscan_wallets(wallet_address, token_address);
CREATE INDEX IF NOT EXISTS idx_wallets_first_buy ON tbl_solscan_wallets(first_buy_timestamp);
CREATE INDEX IF NOT EXISTS idx_wallets_first_sell ON tbl_solscan_wallets(first_sell_timestamp);

-- Create the credentials table
CREATE TABLE IF NOT EXISTS credentials (
  id SERIAL PRIMARY KEY,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create the dashboard_filter_presets table
CREATE TABLE IF NOT EXISTS tbl_solscan_dashboard_filter_presets (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    filters_json JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for dashboard_filter_presets
CREATE INDEX IF NOT EXISTS idx_filter_preset_name ON tbl_solscan_dashboard_filter_presets(name);

-- Optional: Create a view for transaction statistics
CREATE OR REPLACE VIEW transaction_stats AS
SELECT 
    platform,
    type,
    COUNT(*) as transaction_count,
    SUM(CAST(in_amount AS NUMERIC)) as total_in_amount,
    SUM(CAST(out_amount AS NUMERIC)) as total_out_amount,
    DATE(created_at) as date
FROM tbl_solscan_transactions
GROUP BY platform, type, DATE(created_at)
ORDER BY date DESC, platform, type;

