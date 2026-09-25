import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Minimal DB interface over node-postgres (production) or PGlite (local dev/tests, same SQL dialect).
 * BIGINT columns come back as strings; convert with minorFromString from @horos/core.
 */
export interface Queryable {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Queryable {
  /** Runs `fn` in a transaction. Inside `fn`, use only `q` (calling the outer Db can deadlock on PGlite). */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const here = dirname(fileURLToPath(import.meta.url));
export const SCHEMA_SQL = readFileSync(join(here, "schema.sql"), "utf8");

export async function migrate(db: Db): Promise<void> {
  // Single-statement split is safe: schema.sql has no functions or embedded semicolons in strings.
  const statements = SCHEMA_SQL.split(/;\s*\n/)
    .map((s) => s.replace(/--.*$/gm, "").trim())
    .filter(Boolean);
  for (const s of statements) await db.query(s);
}

export async function openDb(opts: { databaseUrl?: string; pgliteDir?: string; memory?: boolean }): Promise<Db> {
  if (opts.databaseUrl) return openPg(opts.databaseUrl);
  return openPglite(opts.memory ? undefined : opts.pgliteDir);
}

async function openPg(url: string): Promise<Db> {
  const pg = await import("pg");
  const pool = new pg.default.Pool({ connectionString: url, max: 10 });
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await pool.query(sql, params);
      return r.rows as T[];
    },
    async tx<T>(fn: (q: Queryable) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const q: Queryable = {
          async query<R>(sql: string, params: unknown[] = []) {
            return (await client.query(sql, params)).rows as R[];
          },
        };
        const out = await fn(q);
        await client.query("COMMIT");
        return out;
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function openPglite(dir: string | undefined): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (dir) mkdirSync(dirname(dir), { recursive: true }); // PGlite only creates the leaf directory
  // BIGINT (oid 20) as string, matching node-postgres, so money never passes through a JS number.
  const opts = { parsers: { 20: (v: string) => v } };
  const pg = dir ? new PGlite(dir, opts) : new PGlite(opts);
  await pg.waitReady;
  // PGlite is single-connection: serialize transactions so they can't interleave.
  let chain: Promise<unknown> = Promise.resolve();
  const raw: Queryable = {
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await pg.query(sql, params as never[]);
      return r.rows as T[];
    },
  };
  return {
    query: (sql, params) => chain.then(() => raw.query(sql, params)) as never,
    tx<T>(fn: (q: Queryable) => Promise<T>) {
      const run = chain.then(() => pg.transaction((t) => fn({ query: async (s, p = []) => (await t.query(s, p as never[])).rows as never })));
      chain = run.catch(() => {});
      return run as Promise<T>;
    },
    close: () => pg.close(),
  };
}
