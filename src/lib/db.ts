import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

/**
 * Data access for Blind.
 *
 * Production speaks to Vercel Postgres / Neon over HTTP (the same client the
 * rest of this workspace uses). Locally and in tests there is no server to
 * point at, so the module runs an embedded Postgres (PGlite) on disk with the
 * identical SQL dialect — which means migrations, constraints and the
 * idempotency guarantees below are exercised by the test suite rather than
 * assumed.
 *
 * Concurrency rules the whole app relies on:
 *   - every invariant that must not race lives in ONE statement (a conditional
 *     UPDATE ... WHERE, or an INSERT ... ON CONFLICT) so it is atomic on both
 *     backends without interactive transactions;
 *   - the database is never the authority on settlement. Chain and wallet
 *     evidence is stored *beside* the payment row, never inferred from it.
 */

const url = process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL;

export const databaseConfigured = Boolean(url);
export const usingEmbeddedDatabase = !url;

/**
 * A development process must not be able to write to the deployed database.
 * `vercel env pull` drops a production DATABASE_URL into `.env.local`, which
 * Next loads automatically, so the mistake is one command away and completely
 * silent. Refuse it, and say how to proceed deliberately.
 */
export class RemoteDatabaseInDevelopment extends Error {
  constructor(host: string) {
    super(
      `Refusing to use the remote database "${host}" from a development process. ` +
        `Remove DATABASE_URL from .env.local to use the embedded Postgres, or set ` +
        `ALLOW_REMOTE_DB_IN_DEV=1 if you really mean to point development at it.`
    );
    this.name = "RemoteDatabaseInDevelopment";
  }
}

function remoteHostInDevelopment(): string | null {
  if (!url) return null;
  if (process.env.NODE_ENV === "production") return null;
  if (process.env.ALLOW_REMOTE_DB_IN_DEV === "1") return null;
  try {
    const host = new URL(url).hostname;
    const local = host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local");
    return local ? null : host;
  } catch {
    return null;
  }
}

type PGliteLike = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
};

let neonClient: NeonQueryFunction<false, false> | null = null;
let embedded: Promise<PGliteLike> | null = null;

function neonDb(): NeonQueryFunction<false, false> {
  if (!url) throw new DatabaseNotConfigured();
  if (!neonClient) neonClient = neon(url);
  return neonClient;
}

export class DatabaseNotConfigured extends Error {
  constructor() {
    super("Database is not configured. Set DATABASE_URL (or DATABASE_URL_POOLED).");
    this.name = "DatabaseNotConfigured";
  }
}

async function embeddedDb(): Promise<PGliteLike> {
  if (!embedded) {
    embedded = (async () => {
      const { PGlite } = await import("@electric-sql/pglite");
      const { mkdir } = await import("node:fs/promises");
      const dataDir = process.env.PGLITE_DIR ?? ".pglite/blind";
      await mkdir(dataDir, { recursive: true });
      const instance = new PGlite(dataDir);
      await instance.waitReady;
      return instance as unknown as PGliteLike;
    })();
  }
  return embedded;
}

async function run<T>(sql: string, params: unknown[]): Promise<T[]> {
  if (url) {
    const remote = remoteHostInDevelopment();
    if (remote) throw new RemoteDatabaseInDevelopment(remote);
    const client = neonDb();
    return await client.query(sql, params as never[]) as T[];
  }
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_EMBEDDED_DB_IN_PROD !== "1") {
    throw new DatabaseNotConfigured();
  }
  const client = await embeddedDb();
  const result = await client.query<T>(sql, params);
  return normalizeTimestamps(result.rows);
}

/**
 * PGlite hands back `timestamptz` columns as `Date` objects; Neon hands back
 * strings. Every caller in Blind expects the string form (and slices it), so
 * the embedded driver is normalised to match production rather than leaving a
 * `value.slice is not a function` to be discovered in a render.
 */
function normalizeTimestamps<T>(rows: T[]): T[] {
  for (const row of rows as Array<Record<string, unknown>>) {
    for (const [key, value] of Object.entries(row)) {
      if (value instanceof Date) row[key] = value.toISOString();
    }
  }
  return rows;
}

/** Rows as plain objects. */
export function query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return run<T>(sql, params);
}

export async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await run<T>(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

/*
 * Compare-and-swap updates return the row they changed (`update ... where ...
 * returning ...`), and the caller treats an empty result as "another writer got
 * there first". Nothing needs a separate affected-row helper.
 */

export const now = () => new Date().toISOString();

export function isoPlusMs(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}
