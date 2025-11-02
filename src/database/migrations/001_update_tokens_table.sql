-- Migration: Update tokens table to add decimal fields
-- This migration adds decimal fields for dev buy amounts

-- Add new decimal columns
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS dev_buy_amount_decimal INTEGER;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS dev_buy_token_amount_decimal INTEGER;

-- Add dev_buy_used_token if it doesn't exist (keep it)
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS dev_buy_used_token VARCHAR(100);

-- Update the table comment
COMMENT ON TABLE tokens IS 'Stores token information including dev buy amounts with decimals';
COMMENT ON COLUMN tokens.dev_buy_amount IS 'Raw amount spent on dev buy (amount_1 from Solscan)';
COMMENT ON COLUMN tokens.dev_buy_amount_decimal IS 'Decimal places for dev_buy_amount (token_decimal_1)';
COMMENT ON COLUMN tokens.dev_buy_used_token IS 'Token mint address used for dev buy';
COMMENT ON COLUMN tokens.dev_buy_token_amount IS 'Raw amount of tokens received (amount_2 from Solscan)';
COMMENT ON COLUMN tokens.dev_buy_token_amount_decimal IS 'Decimal places for dev_buy_token_amount (token_decimal_2)';

