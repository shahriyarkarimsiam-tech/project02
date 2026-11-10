-- Version 0.4: Expansion for Game 3 - Color Cascade (Match-3 Gem Swap).
ALTER TABLE players ADD COLUMN best_cascade_score INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER IF NOT EXISTS update_cascade_best_score
AFTER UPDATE OF finished_at ON games
WHEN OLD.finished_at IS NULL AND NEW.finished_at IS NOT NULL AND NEW.game_type = 'cascade'
BEGIN
  UPDATE players SET best_cascade_score = MAX(best_cascade_score, NEW.score) WHERE id = NEW.player_id;
END;
