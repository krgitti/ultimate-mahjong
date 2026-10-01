-- 006_replay: log de replay das partidas ranqueadas (item 8.3)
ALTER TABLE match_history ADD COLUMN IF NOT EXISTS replay JSONB;
