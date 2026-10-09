import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyMigrations } from "@/lib/migrations";

let ready: Promise<void> | null = null;

/**
 * A private embedded Postgres for one test file, with the real migrations
 * applied. Each file gets its own data directory, so the suite exercises the
 * same constraints, conditional UPDATEs and unique indexes production runs on.
 */
export function testDatabase(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      process.env.PGLITE_DIR = process.env.PGLITE_DIR ?? mkdtempSync(path.join(tmpdir(), "blind-test-"));
      process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "blind-test-secret-long-enough-to-sign";
      const { query } = await import("@/lib/db");
      await applyMigrations({
        query: async (sql, params = []) => ({ rows: await query(sql, params as unknown[]) }),
      });
    })();
  }
  return ready;
}
