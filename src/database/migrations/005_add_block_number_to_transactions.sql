-- Migration: Add block_number column to transactions table
-- This migration adds block_number to track which block each transaction was included in

-- Add block_number column (BIGINT to handle large slot numbers)
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS block_number BIGINT;

-- Create index for block_number for better query performance
CREATE INDEX IF NOT EXISTS idx_block_number ON transactions(block_number);

-- Add comment
COMMENT ON COLUMN transactions.block_number IS 'Solana slot/block number where the transaction was included';

