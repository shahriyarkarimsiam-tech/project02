-- Version 0.5: Expansion for Game 4 - Memory Matrix (Sequence Memory Puzzle).
ALTER TABLE players ADD COLUMN best_memory_score INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER IF NOT EXISTS update_memory_best_score
AFTER UPDATE OF finished_at ON games
WHEN OLD.finished_at IS NULL AND NEW.finished_at IS NOT NULL AND NEW.game_type = 'memory'
BEGIN
  UPDATE players SET best_memory_score = MAX(best_memory_score, NEW.score) WHERE id = NEW.player_id;
END;
