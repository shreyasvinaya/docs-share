import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { mkdirSync, readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { config } from "../lib/config.js";
import * as schema from "./schema.js";

const dbPath = `${config.DATA_DIR}/docs-share.db`;
mkdirSync(dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.exec("PRAGMA journal_mode=WAL");
sqlite.exec("PRAGMA foreign_keys=ON");
sqlite.exec("PRAGMA busy_timeout=5000");

const migrationDir = join(import.meta.dir, "migrations");
if (existsSync(migrationDir)) {
  const files = Bun.file(join(migrationDir, "meta", "_journal.json"));
  if (await files.exists()) {
    const journal = await files.json() as { entries: { idx: number; tag: string }[] };
    for (const entry of journal.entries) {
      const sqlFile = join(migrationDir, `${entry.tag}.sql`);
      if (existsSync(sqlFile)) {
        const sql = readFileSync(sqlFile, "utf-8");
        const statements = sql
          .split("--> statement-breakpoint")
          .map((s) => s.trim())
          .filter(Boolean);
        for (const stmt of statements) {
          try {
            sqlite.exec(stmt);
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            if (
              !msg.includes("already exists") &&
              !msg.includes("duplicate column name")
            )
              throw e;
          }
        }
      }
    }
  }
}

export const db = drizzle(sqlite, { schema });
export { schema };
