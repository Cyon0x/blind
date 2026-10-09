import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `vercel env pull` writes the deployed DATABASE_URL into `.env.local`, which
 * Next loads automatically — so a dev server can end up writing to production
 * data without anyone choosing it. db.ts refuses that, and these tests pin the
 * refusal, the escape hatch, and the local path.
 */

const KEYS = ["DATABASE_URL", "DATABASE_URL_POOLED", "ALLOW_REMOTE_DB_IN_DEV"] as const;
const saved: Record<string, string | undefined> = {};
const REMOTE = "postgresql://user:secret@ep-cool-cell-123456.eu-central-1.aws.neon.tech/neondb";

beforeEach(() => {
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.resetModules();
});

async function loadDb() {
  vi.resetModules();
  return await import("@/lib/db");
}

describe("development database guard", () => {
  it("refuses a remote database from a development process", async () => {
    process.env.DATABASE_URL = REMOTE;
    const db = await loadDb();
    await expect(db.query("select 1")).rejects.toThrow(/Refusing to use the remote database/);
  });

  it("names the host so the mistake is obvious", async () => {
    process.env.DATABASE_URL = REMOTE;
    const db = await loadDb();
    await expect(db.query("select 1")).rejects.toThrow(/ep-cool-cell-123456\.eu-central-1\.aws\.neon\.tech/);
  });

  it("demands an explicit opt-in to point development at a remote database", async () => {
    process.env.DATABASE_URL = REMOTE;
    process.env.ALLOW_REMOTE_DB_IN_DEV = "1";
    const db = await loadDb();
    const failure = await db.query("select 1").catch((error: unknown) => error);
    // It may fail to reach Neon from a test runner, but never with the guard.
    expect(String(failure)).not.toMatch(/Refusing to use the remote database/);
  });

  it("allows a loopback database without ceremony", async () => {
    process.env.DATABASE_URL = "postgresql://user:pw@127.0.0.1:5432/blind";
    const db = await loadDb();
    const failure = await db.query("select 1").catch((error: unknown) => error);
    expect(String(failure)).not.toMatch(/Refusing to use the remote database/);
  });

  it("uses the embedded database when no URL is set at all", async () => {
    const db = await loadDb();
    expect(db.databaseConfigured).toBe(false);
    expect(db.usingEmbeddedDatabase).toBe(true);
  });
});
