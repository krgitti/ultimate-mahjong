-- 001_init: base schema (rooms, accounts, room_seats)
CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS accounts (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  token_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS room_seats (
  code TEXT NOT NULL,
  seat INT NOT NULL,
  account_id INT NOT NULL,
  PRIMARY KEY (code, seat)
);
