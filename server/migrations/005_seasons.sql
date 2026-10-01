-- 005_seasons: temporadas ranqueadas mensais (item 8.1)
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS season TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS prev_season TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS prev_elo INT;
ALTER TABLE match_history ADD COLUMN IF NOT EXISTS season TEXT;
