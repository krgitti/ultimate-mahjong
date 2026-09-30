-- 002_ranked_stats: ranked-play statistics on accounts (item 4b)
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ranked_played INT NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ranked_wins INT NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ranked_points INT NOT NULL DEFAULT 0;
