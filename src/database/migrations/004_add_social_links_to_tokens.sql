-- Migration: Add social links to tokens table
-- This migration adds columns for social media links (twitter, website, discord, telegram)

-- Add social link columns
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS twitter TEXT;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS discord TEXT;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS telegram TEXT;

-- Update the table comment
COMMENT ON TABLE tokens IS 'Stores token information including dev buy amounts and social links';
COMMENT ON COLUMN tokens.twitter IS 'Twitter/X profile URL';
COMMENT ON COLUMN tokens.website IS 'Official website URL';
COMMENT ON COLUMN tokens.discord IS 'Discord server invite URL';
COMMENT ON COLUMN tokens.telegram IS 'Telegram channel/group URL';

