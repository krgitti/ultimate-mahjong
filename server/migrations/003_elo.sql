-- 003_elo: Elo rating for ranked play (item 6, pedido 6 — passo 1)
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS elo INT NOT NULL DEFAULT 1500;
