import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Applies db/migrations/*.sql in filename order and records what ran in
 * schema_migrations, so it is safe to re-run. Shared by `npm run db:migrate`
 * and by the test suite (which runs a real embedded Postgres).
 */
export type MigrationTarget = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

export type MigrationResult = { applied: string[]; skipped: string[] };

export async function applyMigrations(
  target: MigrationTarget,
  migrationsDir = path.join(process.cwd(), "db", "migrations")
): Promise<MigrationResult> {
  await target.query(
    "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())"
  );
  const done = new Set(
    (await target.query("select name from schema_migrations")).rows.map((row) => String(row.name))
  );
  const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    if (done.has(file)) {
      skipped.push(file);
      continue;
    }
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    for (const statement of splitStatements(sql)) {
      await target.query(statement);
    }
    await target.query("insert into schema_migrations (name) values ($1) on conflict do nothing", [file]);
    applied.push(file);
  }
  return { applied, skipped };
}

/**
 * Splits a migration file on top-level semicolons. Dollar-quoted bodies and
 * string literals are respected; the comments in our files never contain a
 * bare semicolon at the start of a line.
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inString = false;
  let dollarTag: string | null = null;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) {
        current += dollarTag;
        i += dollarTag.length - 1;
        dollarTag = null;
        continue;
      }
      current += char;
      continue;
    }
    if (inString) {
      current += char;
      if (char === "'") inString = false;
      continue;
    }
    if (char === "'") {
      inString = true;
      current += char;
      continue;
    }
    if (char === "$") {
      const match = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (match) {
        dollarTag = match[0];
        current += dollarTag;
        i += dollarTag.length - 1;
        continue;
      }
    }
    if (char === ";") {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = "";
      continue;
    }
    current += char;
  }
  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}
