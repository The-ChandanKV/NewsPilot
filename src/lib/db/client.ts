import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";
import { getEnv } from "@/config/env";
import { logger } from "@/lib/logger";
import * as schema from "@/lib/db/schema";

let sqlite: Database.Database | null = null;
let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;

function resolveDbPath(databaseUrl: string): string {
  if (path.isAbsolute(databaseUrl)) {
    return databaseUrl;
  }
  return path.join(process.cwd(), databaseUrl);
}

export function getDbPath(): string {
  return resolveDbPath(getEnv().DATABASE_URL);
}

export function getDb() {
  if (dbInstance) {
    return dbInstance;
  }

  const dbPath = getDbPath();
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });

  sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  dbInstance = drizzle(sqlite, { schema });
  logger.info("Database connection established", { path: dbPath });
  return dbInstance;
}

/** Test helper — closes the singleton so a new DATABASE_URL can be used. */
export function resetDbConnectionForTests() {
  if (sqlite) {
    sqlite.close();
  }
  sqlite = null;
  dbInstance = null;
}

export function checkDatabaseConnection(): { connected: boolean; path: string } {
  const dbPath = getDbPath();
  try {
    const db = getDb();
    db.run(sql`SELECT 1`);
    return { connected: true, path: dbPath };
  } catch (error) {
    logger.error("Database health check failed", {
      path: dbPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return { connected: false, path: dbPath };
  }
}
