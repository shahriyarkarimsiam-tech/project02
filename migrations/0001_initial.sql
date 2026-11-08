PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  username TEXT,
  coins INTEGER NOT NULL DEFAULT 0 CHECK(coins >= 0),
  best_score INTEGER NOT NULL DEFAULT 0 CHECK(best_score >= 0),
  games_played INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS player_days (
  player_id TEXT NOT NULL REFERENCES players(id),
  day TEXT NOT NULL,
  PRIMARY KEY(player_id, day)
);
CREATE INDEX IF NOT EXISTS idx_player_days_day ON player_days(day);
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  seed INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  score INTEGER NOT NULL DEFAULT 0 CHECK(score >= 0),
  moves_count INTEGER NOT NULL DEFAULT 0,
  coins_awarded INTEGER NOT NULL DEFAULT 0 CHECK(coins_awarded >= 0)
);
CREATE INDEX IF NOT EXISTS idx_games_player_started ON games(player_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_games_started ON games(started_at);
CREATE TRIGGER IF NOT EXISTS grant_finish_coins
AFTER UPDATE OF finished_at ON games
WHEN OLD.finished_at IS NULL AND NEW.finished_at IS NOT NULL
BEGIN
  UPDATE players SET
    coins = coins + NEW.coins_awarded,
    games_played = games_played + 1,
    best_score = MAX(best_score, NEW.score)
  WHERE id = NEW.player_id;
END;
