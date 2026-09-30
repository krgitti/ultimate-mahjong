// @vitest-environment node
import { describe, it, expect } from 'vitest';
import pg from 'pg';
import { runMigrations, MIGRATIONS_DIR } from '../../server/migrate';
import { readdir } from 'node:fs/promises';

const DB = process.env.UMO_TEST_DATABASE_URL || 'postgres://umo:umo@127.0.0.1:5432/umo';
const TESTDB = 'umo_migrate_test';
const TESTURL = `postgres://umo:umo@127.0.0.1:5432/${TESTDB}`;

async function dbAvailable(): Promise<boolean> {
  try {
    const c = new pg.Client({ connectionString: DB });
    await c.connect();
    await c.end();
    return true;
  } catch {
    return false;
  }
}

describe('item 5 — migrações SQL versionadas', () => {
  it('aplica as migrações em um banco novo, é idempotente e cria o schema completo', async () => {
    if (!(await dbAvailable())) {
      console.log('postgres unavailable — skipping migrations test');
      return;
    }
    // banco de teste limpo
    const admin = new pg.Client({ connectionString: DB.replace(/\/[^/]+$/, '/postgres') });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${TESTDB}`);
    await admin.query(`CREATE DATABASE ${TESTDB} OWNER umo`);
    await admin.end();

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    expect(files.length).toBeGreaterThanOrEqual(2);

    const first = await runMigrations(TESTURL);
    expect(first).toEqual(files.map((f) => f.replace(/\.sql$/, '')));

    // segunda rodada: nada a aplicar
    const second = await runMigrations(TESTURL);
    expect(second).toEqual([]);

    // schema esperado
    const c = new pg.Client({ connectionString: TESTURL });
    await c.connect();
    const tables = await c.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
    );
    const names = tables.rows.map((r) => r.table_name as string);
    for (const t of ['rooms', 'accounts', 'room_seats', 'schema_migrations']) expect(names).toContain(t);
    const cols = await c.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'accounts'"
    );
    const cn = cols.rows.map((r) => r.column_name as string);
    for (const col of ['ranked_played', 'ranked_wins', 'ranked_points']) expect(cn).toContain(col);
    const applied = await c.query('SELECT version FROM schema_migrations ORDER BY version');
    expect(applied.rows.map((r) => r.version)).toEqual(files.map((f) => f.replace(/\.sql$/, '')));
    await c.end();

    const admin2 = new pg.Client({ connectionString: DB.replace(/\/[^/]+$/, '/postgres') });
    await admin2.connect();
    await admin2.query(`DROP DATABASE ${TESTDB}`);
    await admin2.end();
  }, 90000);

  it('banco antigo (schema pré-migrações) converge sem erros', async () => {
    if (!(await dbAvailable())) {
      console.log('postgres unavailable — skipping legacy convergence test');
      return;
    }
    const admin = new pg.Client({ connectionString: DB.replace(/\/[^/]+$/, '/postgres') });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${TESTDB}`);
    await admin.query(`CREATE DATABASE ${TESTDB} OWNER umo`);
    await admin.end();

    // simula o schema criado pelo init antigo (tabelas sem controle de versão)
    const legacy = new pg.Client({ connectionString: TESTURL });
    await legacy.connect();
    await legacy.query(`
      CREATE TABLE rooms (code TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at BIGINT NOT NULL);
      CREATE TABLE accounts (id SERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL, token_hash TEXT NOT NULL);
      CREATE TABLE room_seats (code TEXT NOT NULL, seat INT NOT NULL, account_id INT NOT NULL, PRIMARY KEY (code, seat));
      INSERT INTO accounts (username, token_hash) VALUES ('legacy-user', 'x');
    `);
    await legacy.end();

    const done = await runMigrations(TESTURL);
    expect(done.length).toBeGreaterThanOrEqual(2);

    // dados antigos preservados + colunas novas presentes
    const c = new pg.Client({ connectionString: TESTURL });
    await c.connect();
    const acc = await c.query("SELECT username, ranked_played FROM accounts WHERE username = 'legacy-user'");
    expect(acc.rows[0].ranked_played).toBe(0);
    await c.end();

    const admin2 = new pg.Client({ connectionString: DB.replace(/\/[^/]+$/, '/postgres') });
    await admin2.connect();
    await admin2.query(`DROP DATABASE ${TESTDB}`);
    await admin2.end();
  }, 90000);
});
