#!/usr/bin/env node
/**
 * Prepares the embedded Postgres Blind uses for local development and tests:
 * it creates the data directory, applies db/migrations, and reports what it
 * found. It never seeds data — a development database starts empty, and every
 * number Blind shows must come from something that really happened.
 *
 *   npm run db:pglite
 */
import { mkdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { applyMigrations } from "../src/lib/migrations.ts";

const dir = process.env.PGLITE_DIR ?? ".pglite/blind";
await mkdir(dir, { recursive: true });

const db = new PGlite(dir);
await db.waitReady;

const started = Date.now();
const { applied, skipped } = await applyMigrations({
  query: (text, params = []) => db.query(text, params),
});

console.log(`embedded Postgres ready at ${dir}`);
for (const name of applied) console.log(`apply  ${name}`);
for (const name of skipped) console.log(`exists ${name}`);

const tables = await db.query(
  `select table_name from information_schema.tables
    where table_schema = 'public'
    order by table_name`
);
console.log(`\n${tables.rows.length} tables in public:`);
for (const row of tables.rows) {
  const name = String(row.table_name);
  const count = await db.query(`select count(*)::text as n from ${JSON.stringify(name).replace(/"/g, '"')}`);
  console.log(`  ${name.padEnd(24)} ${count.rows[0].n} rows`);
}

console.log(`\n${applied.length} migration(s) applied, ${skipped.length} already current, ${Date.now() - started}ms`);
console.log("This is a development database: it holds no payments and no users until you use the app.");
await db.close();
