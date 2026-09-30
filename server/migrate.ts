/**
 * Versioned SQL migrations (item 5).
 *
 * Files in server/migrations/NNN_name.sql are applied in lexicographic
 * order, each inside its own transaction, and recorded in the
 * `schema_migrations` table — so re-running is a no-op and hosting setups
 * can migrate with a single command:
 *
 *   UMO_DATABASE_URL=postgres://user:pass@host/db npx tsx server/migrate.ts
 *
 * The Postgres store also runs them automatically on server boot
 * (PostgresStore.init), so a fresh container converges by itself.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function runMigrations(databaseUrl: string, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await pool.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at BIGINT NOT NULL)'
    );
    const res = await pool.query('SELECT version FROM schema_migrations');
    const applied = new Set(res.rows.map((r) => r.version as string));
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    const done: string[] = [];
    for (const f of files) {
      const version = f.replace(/\.sql$/, '');
      if (applied.has(version)) continue;
      const sql = await readFile(join(dir, f), 'utf8');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)', [
          version,
          Date.now(),
        ]);
        await client.query('COMMIT');
        done.push(version);
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`migration ${version} failed: ${(e as Error).message}`);
      } finally {
        client.release();
      }
    }
    return done;
  } finally {
    await pool.end();
  }
}

/* CLI: npx tsx server/migrate.ts [databaseUrl] */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.argv[2] || process.env.UMO_DATABASE_URL;
  if (!url) {
    console.error('usage: UMO_DATABASE_URL=postgres://... npx tsx server/migrate.ts [databaseUrl]');
    process.exit(1);
  }
  runMigrations(url)
    .then((done) => {
      console.log(done.length ? `[migrate] applied: ${done.join(', ')}` : '[migrate] up to date');
      process.exit(0);
    })
    .catch((e) => {
      console.error('[migrate]', e);
      process.exit(1);
    });
}
