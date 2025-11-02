-- Migration: Add supply, price, and decimals columns to wallets table
-- This migration adds first_buy_supply, first_buy_price, first_buy_decimals
-- and first_sell_supply, first_sell_price, first_sell_decimals columns

-- Add new columns for first buy
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS first_buy_supply VARCHAR(100);
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS first_buy_price NUMERIC(20, 8);
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS first_buy_decimals INTEGER;

-- Add new columns for first sell
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS first_sell_supply VARCHAR(100);
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS first_sell_price NUMERIC(20, 8);
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS first_sell_decimals INTEGER;

-- Add comments for documentation
COMMENT ON COLUMN wallets.first_buy_supply IS 'Token supply at the time of first buy';
COMMENT ON COLUMN wallets.first_buy_price IS 'Token price at the time of first buy';
COMMENT ON COLUMN wallets.first_buy_decimals IS 'Token decimals at the time of first buy';
COMMENT ON COLUMN wallets.first_sell_supply IS 'Token supply at the time of first sell';
COMMENT ON COLUMN wallets.first_sell_price IS 'Token price at the time of first sell';
COMMENT ON COLUMN wallets.first_sell_decimals IS 'Token decimals at the time of first sell';

