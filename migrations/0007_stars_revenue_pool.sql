-- Migration 0007: Stars and Weekly Ad Revenue Share Pool

-- Add star and wallet tracking columns to players
ALTER TABLE players ADD COLUMN stars INTEGER DEFAULT 0;
ALTER TABLE players ADD COLUMN weekly_stars INTEGER DEFAULT 0;
ALTER TABLE players ADD COLUMN usdt_balance REAL DEFAULT 0.0;
ALTER TABLE players ADD COLUMN last_ad_at INTEGER DEFAULT 0;
ALTER TABLE players ADD COLUMN payout_wallet TEXT DEFAULT NULL;

-- Track individual verified ad impressions
CREATE TABLE IF NOT EXISTS ad_impressions (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  ad_network TEXT NOT NULL DEFAULT 'direct', -- 'direct' | 'adsgram' | 'monetag'
  week_id TEXT NOT NULL,                     -- e.g. '2026-W46'
  completed_at INTEGER NOT NULL,
  reward_stars INTEGER NOT NULL DEFAULT 1,
  ip_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_ad_impressions_player_week ON ad_impressions(player_id, week_id);
CREATE INDEX IF NOT EXISTS idx_ad_impressions_week ON ad_impressions(week_id);

-- Weekly revenue pools
CREATE TABLE IF NOT EXISTS weekly_pools (
  week_id TEXT PRIMARY KEY,
  total_revenue_usdt REAL DEFAULT 0.0,
  community_pool_usdt REAL DEFAULT 0.0,
  total_stars INTEGER DEFAULT 0,
  value_per_star REAL DEFAULT 0.0,
  status TEXT DEFAULT 'active',
  settled_at INTEGER DEFAULT NULL
);

-- Withdrawal requests for users cashing out USDT
CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  amount_usdt REAL NOT NULL,
  network TEXT NOT NULL DEFAULT 'TON',       -- 'TON' | 'TRC20'
  wallet_address TEXT NOT NULL,
  status TEXT DEFAULT 'pending',             -- 'pending' | 'completed' | 'rejected'
  requested_at INTEGER NOT NULL,
  processed_at INTEGER DEFAULT NULL,
  tx_hash TEXT DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_player ON withdrawal_requests(player_id);
