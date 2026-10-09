#!/usr/bin/env node
/**
 * Applies db/migrations against DATABASE_URL (Neon) when set, otherwise
 * against the local embedded Postgres used for development.
 *
 *   npm run db:migrate            # uses .env.local / environment
 *   npm run db:migrate -- --embedded   # force the local embedded instance
 */
import { neon } from "@neondatabase/serverless";
import { applyMigrations } from "../src/lib/migrations.ts";

const forceEmbedded = process.argv.includes("--embedded");
const url = forceEmbedded ? null : process.env.DATABASE_URL || process.env.DATABASE_URL_POOLED;

let target;
if (url) {
  const sql = neon(url);
  target = { query: (text, params = []) => sql.query(text, params).then((rows) => ({ rows })) };
  console.log("target: DATABASE_URL (Neon/Postgres)");
} else {
  const { PGlite } = await import("@electric-sql/pglite");
  const { mkdir } = await import("node:fs/promises");
  const dir = process.env.PGLITE_DIR ?? ".pglite/blind";
  await mkdir(dir, { recursive: true });
  const db = new PGlite(dir);
  await db.waitReady;
  target = { query: (text, params = []) => db.query(text, params) };
  console.log(`target: embedded Postgres at ${dir}`);
}

const started = Date.now();
const { applied, skipped } = await applyMigrations(target);
for (const name of skipped) console.log(`skip  ${name}`);
for (const name of applied) console.log(`apply ${name}`);
console.log(`${applied.length} applied, ${skipped.length} already current, ${Date.now() - started}ms`);
