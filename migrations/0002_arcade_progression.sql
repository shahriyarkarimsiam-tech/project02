-- Version 0.2. Existing games and player balances are preserved.
ALTER TABLE players ADD COLUMN equipped_theme TEXT NOT NULL DEFAULT 'mint';
ALTER TABLE players ADD COLUMN best_tile INTEGER NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN mode TEXT NOT NULL DEFAULT 'classic' CHECK(mode IN ('classic', 'daily'));
ALTER TABLE games ADD COLUMN challenge_day TEXT;
ALTER TABLE games ADD COLUMN best_tile INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_entry ON games(player_id, challenge_day) WHERE mode='daily';
CREATE INDEX IF NOT EXISTS idx_daily_ranks ON games(challenge_day, mode, score DESC) WHERE finished_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS themes (
  id TEXT PRIMARY KEY,
  cost INTEGER NOT NULL CHECK(cost>=0)
);
INSERT OR IGNORE INTO themes(id, cost) VALUES
  ('mint',0),('aurora',25),('sunset',60),('midnight',100);

CREATE TABLE IF NOT EXISTS player_themes (
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  theme_id TEXT NOT NULL REFERENCES themes(id),
  unlocked_at INTEGER NOT NULL,
  PRIMARY KEY(player_id, theme_id)
);

-- One SQLite trigger keeps virtual currency deductions atomic with an unlock.
-- The cost is read from the database, never from a user-submitted value.
CREATE TRIGGER IF NOT EXISTS theme_purchase_charge
AFTER INSERT ON player_themes
BEGIN
  UPDATE players SET coins = coins - (SELECT cost FROM themes WHERE id=NEW.theme_id)
    WHERE id=NEW.player_id AND coins >= (SELECT cost FROM themes WHERE id=NEW.theme_id);
  SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'Insufficient virtual coins') END;
END;

CREATE TRIGGER IF NOT EXISTS update_best_tile
AFTER UPDATE OF finished_at ON games
WHEN OLD.finished_at IS NULL AND NEW.finished_at IS NOT NULL
BEGIN
  UPDATE players SET best_tile = MAX(best_tile, NEW.best_tile) WHERE id=NEW.player_id;
END;
