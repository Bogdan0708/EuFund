-- Add user_tier column to users table
-- This enables tiered access control for AI endpoints

-- Add tier column with default 'free'
ALTER TABLE users ADD COLUMN tier VARCHAR(20) DEFAULT 'free';

-- Add constraint to ensure valid tier values
ALTER TABLE users ADD CONSTRAINT check_user_tier 
  CHECK (tier IN ('free', 'pro', 'enterprise'));

-- Create index for efficient tier-based queries
CREATE INDEX idx_users_tier ON users(tier);

-- Update existing users to 'free' tier (redundant but explicit)
UPDATE users SET tier = 'free' WHERE tier IS NULL;

-- Add comment for documentation
COMMENT ON COLUMN users.tier IS 'User subscription tier: free, pro, or enterprise';