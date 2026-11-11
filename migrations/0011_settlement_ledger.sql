-- Migration 0011: Immutable settlement payouts ledger
CREATE TABLE IF NOT EXISTS settlement_payouts (
  id TEXT PRIMARY KEY,
  week_id TEXT NOT NULL,
  player_id TEXT NOT NULL REFERENCES players(id),
  stars_converted INTEGER NOT NULL,
  rate_per_star REAL NOT NULL,
  usdt_credited REAL NOT NULL,
  settled_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_settlement_payouts_week ON settlement_payouts(week_id);
CREATE INDEX IF NOT EXISTS idx_settlement_payouts_player ON settlement_payouts(player_id);
CREATE INDEX IF NOT EXISTS idx_settlement_payouts_date ON settlement_payouts(settled_at DESC);
