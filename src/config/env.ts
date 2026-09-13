import { z } from "zod";

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_NAME: z.string().default("NewsPilot"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  DATABASE_URL: z.string().min(1).default("./data/newspilot.db"),

  AI_PROVIDER: z.enum(["claude", "gemini"]).default("claude"),
  ANTHROPIC_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-20250514"),
  GOOGLE_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  GEMINI_MODEL: z.string().default("gemini-2.0-flash"),
  SIMILARITY_PROVIDER: z.enum(["deterministic", "embedding"]).default("deterministic"),

  NEWS_PROVIDERS: z.string().default("google_news_rss,newsapi"),
  NEWSAPI_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  GNEWS_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  /** Optional directory of `{topic-slug}.xml` fixtures for offline/dev testing. */
  NEWS_RSS_FIXTURE_DIR: z.preprocess(emptyToUndefined, z.string().optional()),

  NEWS_RECENCY_HOURS: z.coerce.number().int().positive().default(48),
  BRIEFING_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(10800),
  /** How long to keep prior topic briefings for NEW/UPDATED/ONGOING detection. */
  TOPIC_HISTORY_TTL_SECONDS: z.coerce.number().int().positive().default(604800),
  NEWS_FETCH_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(1800),
  /**
   * When true, call the LLM for a short change explanation on material UPDATED
   * stories (headline + coverage changed). Deterministic summaries always run.
   */
  EXPLAIN_CHANGES_WITH_AI: z
    .preprocess((value) => {
      if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (["1", "true", "yes", "on"].includes(normalized)) return true;
        if (["0", "false", "no", "off", ""].includes(normalized)) return false;
      }
      return value;
    }, z.boolean())
    .default(false),
  MAX_ARTICLES_PER_SEARCH: z.coerce.number().int().positive().default(50),
  MAX_STORIES_PER_BRIEFING: z.coerce.number().int().positive().default(15),
  NEWS_PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  NEWS_PROVIDER_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),

  // Ranking weights (also available via getScoringConfig)
  RANK_WEIGHT_RELEVANCE: z.coerce.number().min(0).max(1).default(0.35),
  RANK_WEIGHT_FRESHNESS: z.coerce.number().min(0).max(1).default(0.25),
  RANK_WEIGHT_SOURCE_DIVERSITY: z.coerce.number().min(0).max(1).default(0.2),
  RANK_WEIGHT_SOURCE_QUALITY: z.coerce.number().min(0).max(1).default(0.2),
  HEADLINE_NEAR_DUPLICATE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.85),
  STORY_CLUSTER_SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.5),
  FRESHNESS_HALF_LIFE_HOURS: z.coerce.number().positive().default(24),
  SOURCE_DIVERSITY_SATURATION: z.coerce.number().int().positive().default(5),

  // AI summarization
  AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(1024),
  AI_PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  AI_PROVIDER_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  AI_SUMMARY_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(21600),
  MAX_STORIES_TO_SUMMARIZE: z.coerce.number().int().positive().default(8),
  AI_SUMMARY_MAX_ARTICLES_PER_CLUSTER: z.coerce.number().int().positive().default(6),

  // Automatic daily briefings
  /** Local hour (0–23) when the daily job should run. */
  DAILY_BRIEFING_HOUR: z.coerce.number().int().min(0).max(23).default(6),
  /** Local minute (0–59). */
  DAILY_BRIEFING_MINUTE: z.coerce.number().int().min(0).max(59).default(0),
  /** IANA timezone for the schedule (used for date keys + docs). */
  DAILY_BRIEFING_TIMEZONE: z.string().default("UTC"),
  /**
   * Comma-separated topic frequencies to include in the daily job.
   * Example: daily,twice_daily
   */
  DAILY_BRIEFING_FREQUENCIES: z.string().default("daily,twice_daily"),
  /** Optional shared secret for POST /api/jobs/daily-briefings */
  DAILY_JOB_SECRET: z.preprocess(emptyToUndefined, z.string().optional()),

  // Daily news email delivery (reuses StoredDailyBriefing — no extra LLM calls)
  /** log = stdout only; resend = Resend HTTP API */
  NOTIFICATION_PROVIDER: z.enum(["log", "resend"]).default("log"),
  RESEND_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  EMAIL_FROM: z.preprocess(emptyToUndefined, z.string().optional()),
  EMAIL_PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  EMAIL_MAX_SEND_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  /** Public base URL for unsubscribe links (e.g. https://newspilot.example) */
  APP_BASE_URL: z.string().default("http://localhost:3000"),
  /**
   * When true, the daily briefings CLI/API also runs email delivery after generation.
   */
  EMAIL_DELIVERY_AFTER_BRIEFINGS: z
    .preprocess((value) => {
      if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (["1", "true", "yes", "on"].includes(normalized)) return true;
        if (["0", "false", "no", "off", ""].includes(normalized)) return false;
      }
      return value;
    }, z.boolean())
    .default(true),
});

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}

/** Test helper — clears cached env so DATABASE_URL overrides take effect. */
export function resetEnvForTests() {
  cachedEnv = null;
}

export function getEnabledNewsProviders(): Array<"google_news_rss" | "newsapi" | "gnews"> {
  const { NEWS_PROVIDERS } = getEnv();
  const allowed = new Set(["google_news_rss", "newsapi", "gnews"] as const);

  return NEWS_PROVIDERS.split(",")
    .map((value) => value.trim())
    .filter((value): value is "google_news_rss" | "newsapi" | "gnews" =>
      allowed.has(value as "google_news_rss" | "newsapi" | "gnews"),
    );
}
