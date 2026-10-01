-- 007_replays: replays compartilháveis por código (item 9.2)
CREATE TABLE IF NOT EXISTS replays (
  code TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  created_at BIGINT NOT NULL
);
