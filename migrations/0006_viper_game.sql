-- Migration 0006: Add Neon Viper support to players table and triggers
ALTER TABLE players ADD COLUMN best_viper_score INTEGER DEFAULT 0;

CREATE TRIGGER IF NOT EXISTS update_viper_best_score
AFTER UPDATE ON games
WHEN NEW.game_type = 'viper' AND NEW.finished_at IS NOT NULL
BEGIN
  UPDATE players
  SET best_viper_score = MAX(COALESCE(best_viper_score, 0), NEW.score)
  WHERE id = NEW.player_id;
END;
