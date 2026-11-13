-- Migration 0012: $5.00 USDT Welcome Joining Bonus
ALTER TABLE players ADD COLUMN claimed_welcome_bonus INTEGER NOT NULL DEFAULT 0;
