-- PostgreSQL Schema for Solana Transaction Storage
-- Run this manually if you need to set up the database from scratch

-- Create the database (if needed)
-- CREATE DATABASE solscan;

-- Create the transactions table
CREATE TABLE IF NOT EXISTS transactions (
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
CREATE INDEX IF NOT EXISTS idx_transaction_id ON transactions(transaction_id);
CREATE INDEX IF NOT EXISTS idx_platform ON transactions(platform);
CREATE INDEX IF NOT EXISTS idx_created_at ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_fee_payer ON transactions(fee_payer);
CREATE INDEX IF NOT EXISTS idx_block_number ON transactions(block_number);
CREATE INDEX IF NOT EXISTS idx_block_timestamp ON transactions(block_timestamp);

-- Create the tokens table for storing token creator and first buy info
CREATE TABLE IF NOT EXISTS tokens (
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
CREATE INDEX IF NOT EXISTS idx_mint_address ON tokens(mint_address);
CREATE INDEX IF NOT EXISTS idx_creator ON tokens(creator);
CREATE INDEX IF NOT EXISTS idx_tokens_created_at ON tokens(created_at);
CREATE INDEX IF NOT EXISTS idx_dev_buy_timestamp ON tokens(dev_buy_timestamp);
CREATE INDEX IF NOT EXISTS idx_dev_buy_block_number ON tokens(dev_buy_block_number);

-- Create the skip_tokens table for tokens to skip when analyzing
CREATE TABLE IF NOT EXISTS skip_tokens (
    id SERIAL PRIMARY KEY,
    mint_address VARCHAR(100) UNIQUE NOT NULL,
    symbol VARCHAR(50),
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for skip_tokens table
CREATE INDEX IF NOT EXISTS idx_skip_mint_address ON skip_tokens(mint_address);

-- Create the wallets table for tracking wallet-token pairs
CREATE TABLE IF NOT EXISTS wallets (
    id SERIAL PRIMARY KEY,
    wallet_address VARCHAR(100) NOT NULL,
    token_address VARCHAR(100) NOT NULL,
    first_buy_timestamp TIMESTAMP,
    first_buy_amount VARCHAR(100),
    first_buy_mcap NUMERIC(20, 2),
    first_buy_supply VARCHAR(100),
    first_buy_price NUMERIC(20, 8),
    first_buy_decimals INTEGER,
    first_sell_timestamp TIMESTAMP,
    first_sell_amount VARCHAR(100),
    first_sell_mcap NUMERIC(20, 2),
    first_sell_supply VARCHAR(100),
    first_sell_price NUMERIC(20, 8),
    first_sell_decimals INTEGER,
    peak_buy_to_sell_price_sol NUMERIC(20, 9),
    peak_buy_to_sell_price_usd NUMERIC(20, 9),
    peak_buy_to_sell_mcap NUMERIC(20, 2),
    peak_sell_to_end_price_sol NUMERIC(20, 9),
    peak_sell_to_end_price_usd NUMERIC(20, 9),
    peak_sell_to_end_mcap NUMERIC(20, 2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(wallet_address, token_address)
);

-- Create indexes for wallets table
CREATE INDEX IF NOT EXISTS idx_wallet_address ON wallets(wallet_address);
CREATE INDEX IF NOT EXISTS idx_token_address ON wallets(token_address);
CREATE INDEX IF NOT EXISTS idx_wallet_token ON wallets(wallet_address, token_address);
CREATE INDEX IF NOT EXISTS idx_wallets_first_buy ON wallets(first_buy_timestamp);
CREATE INDEX IF NOT EXISTS idx_wallets_first_sell ON wallets(first_sell_timestamp);

-- Create the credentials table
CREATE TABLE IF NOT EXISTS credentials (
    id SERIAL PRIMARY KEY,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create the dashboard_filter_presets table
CREATE TABLE IF NOT EXISTS dashboard_filter_presets (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    filters_json JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for dashboard_filter_presets
CREATE INDEX IF NOT EXISTS idx_filter_preset_name ON dashboard_filter_presets(name);

-- Optional: Create a view for transaction statistics
CREATE OR REPLACE VIEW transaction_stats AS
SELECT 
    platform,
    type,
    COUNT(*) as transaction_count,
    SUM(CAST(in_amount AS NUMERIC)) as total_in_amount,
    SUM(CAST(out_amount AS NUMERIC)) as total_out_amount,
    DATE(created_at) as date
FROM transactions
GROUP BY platform, type, DATE(created_at)
ORDER BY date DESC, platform, type;

