-- 008_season_results: pódio arquivado de cada temporada encerrada (item 9.3)
CREATE TABLE IF NOT EXISTS season_results (
  season TEXT NOT NULL,
  username TEXT NOT NULL,
  elo INT NOT NULL,
  ranked_played INT NOT NULL,
  ranked_wins INT NOT NULL,
  archived_at BIGINT NOT NULL,
  PRIMARY KEY (season, username)
);
