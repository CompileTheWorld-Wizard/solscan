-- Migration: Add market cap columns to wallets table
-- This migration adds first_buy_mcap and first_sell_mcap columns

-- Add new mcap columns
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS first_buy_mcap NUMERIC(20, 2);
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS first_sell_mcap NUMERIC(20, 2);

-- Add comments for documentation
COMMENT ON COLUMN wallets.first_buy_mcap IS 'Market cap at the time of first buy';
COMMENT ON COLUMN wallets.first_sell_mcap IS 'Market cap at the time of first sell';

