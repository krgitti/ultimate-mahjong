-- 004_history: histórico de partidas ranqueadas por conta (item 7.1)
CREATE TABLE IF NOT EXISTS match_history (
  id SERIAL PRIMARY KEY,
  account_id INT NOT NULL,
  played_at BIGINT NOT NULL,
  win BOOLEAN NOT NULL,
  points INT NOT NULL,
  elo_before INT NOT NULL,
  elo_after INT NOT NULL,
  room_code TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history_account ON match_history (account_id, played_at DESC);
