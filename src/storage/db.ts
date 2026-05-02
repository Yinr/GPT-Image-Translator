import { Database } from "@db/sqlite";
import { dirname } from "@std/path";
import { migrations } from "./migrations.ts";

export type AppDatabase = Database;

export async function openDatabase(path: string): Promise<AppDatabase> {
  if (path !== ":memory:") {
    await Deno.mkdir(dirname(path), { recursive: true });
  }

  const db = new Database(path);
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations(db);
  return db;
}

export function openMemoryDatabase(): AppDatabase {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations(db);
  return db;
}

function runMigrations(db: AppDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  for (const migration of migrations) {
    const existing = db.prepare("SELECT version FROM schema_migrations WHERE version = ?").get(
      migration.version,
    );
    if (existing) continue;

    db.exec(migration.sql);
    db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
      migration.version,
      new Date().toISOString(),
    );
  }
}
