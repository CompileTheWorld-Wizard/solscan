-- Migration: Add block_timestamp column to transactions table
-- This migration adds block_timestamp to track when each transaction was included in a block

-- Add block_timestamp column (TIMESTAMP to store the block time when transaction was included)
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS block_timestamp TIMESTAMP;

-- Create index for block_timestamp for better query performance
CREATE INDEX IF NOT EXISTS idx_block_timestamp ON transactions(block_timestamp);

-- Add comment
COMMENT ON COLUMN transactions.block_timestamp IS 'Block timestamp when the transaction was included (from blockTime)';

