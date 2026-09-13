/**
 * Standalone SQLite schema bootstrap (no tsx / path aliases required).
 * Mirrors src/lib/db/migrate.ts for CLI use.
 */
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

// Load .env manually (no dotenv dependency)
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

const databaseUrl = process.env.DATABASE_URL || "./data/newspilot.db";
const dbPath = path.isAbsolute(databaseUrl)
  ? databaseUrl
  : path.join(__dirname, "..", databaseUrl);

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS briefing_requests (
    id TEXT PRIMARY KEY,
    topic TEXT NOT NULL,
    normalized_topic TEXT NOT NULL,
    force_refresh INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS briefings (
    id TEXT PRIMARY KEY,
    request_id TEXT REFERENCES briefing_requests(id),
    topic TEXT NOT NULL,
    generated_at TEXT NOT NULL DEFAULT (datetime('now')),
    provider_used TEXT,
    llm_calls INTEGER NOT NULL DEFAULT 0,
    story_count INTEGER NOT NULL DEFAULT 0,
    cache_expires_at TEXT,
    payload_json TEXT
  );

  CREATE TABLE IF NOT EXISTS briefing_stories (
    id TEXT PRIMARY KEY,
    briefing_id TEXT NOT NULL REFERENCES briefings(id),
    rank INTEGER NOT NULL,
    headline TEXT NOT NULL,
    summary TEXT NOT NULL,
    why_it_matters TEXT NOT NULL,
    facts_json TEXT NOT NULL DEFAULT '[]',
    conflicts_json TEXT NOT NULL DEFAULT '[]',
    confidence TEXT NOT NULL DEFAULT 'medium',
    published_at TEXT,
    primary_url TEXT NOT NULL,
    primary_source TEXT NOT NULL,
    related_sources_json TEXT NOT NULL DEFAULT '[]',
    is_ai_generated INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS user_topics (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    topic TEXT NOT NULL,
    normalized_topic TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    frequency TEXT NOT NULL DEFAULT 'daily',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE UNIQUE INDEX IF NOT EXISTS user_topics_client_normalized_uid
  ON user_topics (client_id, normalized_topic);

  CREATE TABLE IF NOT EXISTS search_history (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    topic TEXT NOT NULL,
    normalized_topic TEXT NOT NULL,
    story_count INTEGER NOT NULL DEFAULT 0,
    last_briefing_at TEXT,
    searched_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS search_history_client_normalized_uid
  ON search_history (client_id, normalized_topic);

  CREATE TABLE IF NOT EXISTS saved_stories (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    story_ref_id TEXT NOT NULL,
    headline TEXT NOT NULL,
    summary TEXT NOT NULL,
    source TEXT NOT NULL,
    url TEXT NOT NULL,
    topic TEXT NOT NULL,
    saved_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS saved_stories_client_ref_uid
  ON saved_stories (client_id, story_ref_id);

  CREATE TABLE IF NOT EXISTS recently_viewed_stories (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    story_ref_id TEXT NOT NULL,
    headline TEXT NOT NULL,
    source TEXT NOT NULL,
    url TEXT NOT NULL,
    topic TEXT NOT NULL,
    viewed_at TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS recently_viewed_client_ref_uid
  ON recently_viewed_stories (client_id, story_ref_id);

  CREATE TABLE IF NOT EXISTS topic_snapshots (
    normalized_topic TEXT PRIMARY KEY,
    topic TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stored_daily_briefings (
    id TEXT PRIMARY KEY,
    topic TEXT NOT NULL,
    normalized_topic TEXT NOT NULL,
    date TEXT NOT NULL,
    generated_at TEXT NOT NULL,
    stories_json TEXT NOT NULL,
    changes_json TEXT NOT NULL,
    stats_json TEXT NOT NULL,
    warnings_json TEXT NOT NULL DEFAULT '[]',
    top_developments_json TEXT NOT NULL DEFAULT '[]',
    why_it_matters_json TEXT NOT NULL DEFAULT '[]'
  );

  CREATE UNIQUE INDEX IF NOT EXISTS stored_daily_briefings_topic_date_uid
  ON stored_daily_briefings (normalized_topic, date);

  CREATE TABLE IF NOT EXISTS job_runs (
    job_key TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    result_json TEXT,
    error TEXT
  );
`);

db.close();
console.log(`Migration complete: ${dbPath}`);
