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
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_transaction_id ON transactions(transaction_id);
CREATE INDEX IF NOT EXISTS idx_platform ON transactions(platform);
CREATE INDEX IF NOT EXISTS idx_created_at ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_fee_payer ON transactions(fee_payer);

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
    token_name VARCHAR(200),
    symbol VARCHAR(50),
    image TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for tokens table
CREATE INDEX IF NOT EXISTS idx_mint_address ON tokens(mint_address);
CREATE INDEX IF NOT EXISTS idx_creator ON tokens(creator);
CREATE INDEX IF NOT EXISTS idx_tokens_created_at ON tokens(created_at);

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

