-- Migration 0010: Add rejection_reason and admin_note to withdrawal_requests
ALTER TABLE withdrawal_requests ADD COLUMN rejection_reason TEXT DEFAULT NULL;
ALTER TABLE withdrawal_requests ADD COLUMN admin_note TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawal_requests(status);
CREATE INDEX IF NOT EXISTS idx_withdrawals_player_date ON withdrawal_requests(player_id, requested_at DESC);
