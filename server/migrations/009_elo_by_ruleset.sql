-- item 11.5: Elo por variante (elo = HK clássica; riichi e mcr em colunas próprias)
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS elo_riichi INTEGER NOT NULL DEFAULT 1500;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS elo_mcr INTEGER NOT NULL DEFAULT 1500;
