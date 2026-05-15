import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { config } from "../lib/config.js";
import * as schema from "./schema.js";

const dbPath = `${config.DATA_DIR}/docs-share.db`;
mkdirSync(dirname(dbPath), { recursive: true });

const sqlite = new Database(dbPath);
sqlite.exec("PRAGMA journal_mode=WAL");
sqlite.exec("PRAGMA foreign_keys=ON");
sqlite.exec("PRAGMA busy_timeout=5000");

export const db = drizzle(sqlite, { schema });
export { schema };
