-- Version 0.3: Multi-game expansion for Block Collapse and future arcade titles.
ALTER TABLE games ADD COLUMN game_type TEXT NOT NULL DEFAULT 'merge';
CREATE INDEX IF NOT EXISTS idx_games_type_ranks ON games(game_type, mode, score DESC) WHERE finished_at IS NOT NULL;
ALTER TABLE players ADD COLUMN best_blocks_score INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER IF NOT EXISTS update_blocks_best_score
AFTER UPDATE OF finished_at ON games
WHEN OLD.finished_at IS NULL AND NEW.finished_at IS NOT NULL AND NEW.game_type = 'blocks'
BEGIN
  UPDATE players SET best_blocks_score = MAX(best_blocks_score, NEW.score) WHERE id = NEW.player_id;
END;
