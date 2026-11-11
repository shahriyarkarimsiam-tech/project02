-- Migration 0009: Unique Bot Referrals and 10-Referral Lifetime Withdrawal Unlock
ALTER TABLE players ADD COLUMN referred_by TEXT DEFAULT NULL;
ALTER TABLE players ADD COLUMN referrals_count INTEGER DEFAULT 0;
ALTER TABLE players ADD COLUMN has_withdrawn INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS referrals (
  id TEXT PRIMARY KEY,
  referrer_id TEXT NOT NULL,
  referred_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_id);
