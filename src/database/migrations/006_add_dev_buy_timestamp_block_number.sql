-- Migration: Add dev_buy_timestamp and dev_buy_block_number to tokens table
-- This migration adds timestamp and block number tracking for dev buy transactions

-- Add dev_buy_timestamp column (TIMESTAMP to store when the dev buy transaction occurred)
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS dev_buy_timestamp TIMESTAMP;

-- Add dev_buy_block_number column (BIGINT to store the block number where dev buy occurred)
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS dev_buy_block_number BIGINT;

-- Create index for dev_buy_block_number for better query performance
CREATE INDEX IF NOT EXISTS idx_dev_buy_block_number ON tokens(dev_buy_block_number);

-- Create index for dev_buy_timestamp for better query performance
CREATE INDEX IF NOT EXISTS idx_dev_buy_timestamp ON tokens(dev_buy_timestamp);

-- Add comments
COMMENT ON COLUMN tokens.dev_buy_timestamp IS 'Timestamp when the dev buy transaction occurred';
COMMENT ON COLUMN tokens.dev_buy_block_number IS 'Block number (slot) where the dev buy transaction was included';

