# NewsPilot

AI-powered news aggregation agent. Phase 1 establishes the monolithic Next.js foundation: config, database, provider adapters, health check, and UI shell.

## Prerequisites

- Node.js 20+
- npm 10+

## Setup

```bash
cp .env.example .env
npm install
npm run db:migrate
```

Fill in API keys in `.env` when you are ready for later phases. Keys are optional for Phase 1.

## Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

- Health: [http://localhost:3000/api/health](http://localhost:3000/api/health)
- News ingestion: [http://localhost:3000/api/news?topic=artificial-intelligence](http://localhost:3000/api/news?topic=artificial-intelligence)
- Ranked stories: [http://localhost:3000/api/stories?topic=artificial-intelligence](http://localhost:3000/api/stories?topic=artificial-intelligence)
- AI briefing: [http://localhost:3000/api/briefing?topic=artificial-intelligence](http://localhost:3000/api/briefing?topic=artificial-intelligence)

Daily briefing response includes `topic`, `generatedAt`, `timeRange`, `totalStories`, and ranked `stories[]` (headline, summary, whyItMatters, keyFacts, sources, URLs, confidence). Briefings are cached (`BRIEFING_CACHE_TTL_SECONDS`); use `?refresh=1` to bypass.

Set `GOOGLE_API_KEY` and `AI_PROVIDER=gemini` for live summarization. Summaries are also cached by story content hash (one LLM call per important cluster, never per article).

By default the Google News RSS provider fetches live results (no API key). For offline tests, set:

```bash
NEWS_RSS_FIXTURE_DIR=./fixtures/rss
NEWS_PROVIDERS=google_news_rss
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm start` | Start production server |
| `npm run db:migrate` | Ensure SQLite schema exists |
| `npm run lint` | Run ESLint |

## Architecture (Phase 1)

- **API** — Next.js App Router route handlers (`src/app/api`)
- **Frontend** — App shell under `src/app` and `src/components` (later)
- **Database** — SQLite via Drizzle (`src/lib/db`)
- **AI providers** — Replaceable adapters (`src/lib/providers/llm`)
- **News providers** — Replaceable adapters (`src/lib/providers/news`)
- **Config** — Environment + defaults (`src/config`)

News search, ranking, clustering, and AI summarization are intentionally not implemented yet.
