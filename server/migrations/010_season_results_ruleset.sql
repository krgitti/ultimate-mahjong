-- 010_season_results_ruleset: pódio da temporada por variante (item 12.2)
ALTER TABLE season_results ADD COLUMN IF NOT EXISTS ruleset TEXT NOT NULL DEFAULT 'classic';
ALTER TABLE season_results DROP CONSTRAINT IF EXISTS season_results_pkey;
ALTER TABLE season_results ADD PRIMARY KEY (season, username, ruleset);
