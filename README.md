# Smelly Loot

Self-hosted loot distribution tool for Final Fantasy XIV savage raid statics.
Replaces the team's loot tracker spreadsheet with automated, fair
recommendations per boss kill, plus upgrade-material and gear-progression
tracking.

> **Status — v1.0.0.** Phase 1 of [`ROADMAP.md`](./ROADMAP.md) is
> complete. The app replaces the spreadsheet end-to-end: players, BiS
> plans, weekly boss kills, page-aware recommendations, history, and
> tier configuration. Polish items and convenience features are
> tracked under "Pending for v1.1" in [`CHANGELOG.md`](./CHANGELOG.md).

## Features

- **Team and player management** with FF XIV job awareness (21 jobs
  grouped by Tank / Healer / Melee / Phys-Range / Caster).
- **Per-slot Best-in-Slot tracker** that mirrors the team's existing
  spreadsheet workflow (Savage / Tome Up / Tome / Crafted / Relic /
  Catchup / Extreme / WHYYYY / Just no.).
- **Automated, transparent loot recommendations** per boss kill. The
  scoring engine accounts for slot demand, current iLv gap, fairness
  (drop count this tier), recency, class-aware role weights, and
  page-buy power so a player who can self-buy is deprioritized.
- **Page accounting** auto-derived from boss kills minus token
  purchases, with a `page_adjust` field for missed weeks /
  alliance-raid carry-over.
- **Material tracker** for Glaze / Twine / Ester upgrade tokens.
- **History view** of every drop, grouped by week, with badges for
  token purchases and manual overrides.
- **DE + EN UI** end to end; light / dark / system theme.

## Quick Start (Docker)

```bash
git clone git@github.com:xXSnakeXx/smelly-loot.git
cd smelly-loot
cp .env.example .env
docker compose up -d --build
```

The app is then served at <http://localhost:3000>. The `HOST_PORT`
environment variable can re-map the host side without rebuilding —
e.g. `HOST_PORT=8070` in `.env` to sit alongside other services.

Database migrations apply automatically on container start (via the
Next.js instrumentation hook), and the SQLite file persists in
`./data/loot.db`. First boot seeds a placeholder team
(`Mannschaft Smelly`) and the active Heavyweight tier (max iLv 795)
with the canonical floor layout and `tier_buy_cost` table.

To upgrade after pulling new code:

```bash
docker compose up -d --build
```

## Local Development

Requirements: Node.js 20+ and pnpm 10+.

```bash
pnpm install            # install all dependencies
pnpm dev                # start the Next.js dev server on :3000
pnpm test               # run the Vitest unit suite
pnpm test:e2e           # run the Playwright end-to-end suite (boots
                        # the production build automatically)
pnpm lint               # Biome lint
pnpm typecheck          # TypeScript --noEmit
pnpm build              # production build
pnpm db:generate        # generate a new Drizzle migration from schema
pnpm db:migrate         # apply pending migrations to the local DB
pnpm db:studio          # open the Drizzle Studio UI for inspection
```

The local database lives at `./data/loot.db` and is created on first
boot. Set `DATABASE_URL` in `.env` to point at a different file or a
remote libSQL/Turso instance.

## Project Layout

```
smelly-loot/
├── messages/                 # next-intl JSON message bundles (en, de)
├── drizzle/                  # generated SQL migrations (committed)
├── public/                   # static assets served at /
├── src/
│   ├── app/[locale]/         # locale-scoped App Router routes
│   │   ├── page.tsx          # Dashboard
│   │   ├── team/             # Team settings
│   │   ├── players/          # Player CRUD + per-player detail (BiS, pages, materials)
│   │   ├── tier/             # Tier configuration
│   │   ├── loot/             # Active raid-week loot distribution
│   │   └── history/          # Per-week loot history
│   ├── components/           # shared UI components (incl. shadcn/ui)
│   ├── i18n/                 # next-intl routing + request config
│   ├── lib/
│   │   ├── db/               # Drizzle schema, libSQL client, queries, seed
│   │   ├── ffxiv/            # Job → role mapping, slot/source enums, iLv math
│   │   ├── loot/             # Scoring engine, snapshots, Server Actions
│   │   ├── players/          # Player CRUD Server Actions
│   │   ├── stats/            # Page-adjust Server Action
│   │   ├── team/             # Team settings Server Action
│   │   └── tiers/            # Tier-edit Server Action
│   ├── instrumentation.ts    # boot-time hook (runs migrations + seed)
│   └── proxy.ts              # Next.js 16 proxy (locale negotiation)
├── e2e/                      # Playwright end-to-end tests
├── Dockerfile                # multi-stage production build
└── docker-compose.yml        # single-service self-host deployment
```

## Tech Stack

| Layer            | Choice                                                  |
| ---------------- | ------------------------------------------------------- |
| Framework        | Next.js 16 (App Router, React 19, Server Actions)       |
| Language         | TypeScript with strict + `exactOptionalPropertyTypes`   |
| UI               | shadcn/ui (base-nova preset) + Tailwind CSS v4          |
| Data grids       | TanStack Table v8 (added in Phase 1)                    |
| Database         | SQLite via `@libsql/client`                             |
| ORM              | Drizzle ORM + drizzle-kit                               |
| Validation       | Zod                                                     |
| i18n             | next-intl (DE / EN)                                     |
| Tests            | Vitest (unit) + Playwright (e2e)                        |
| Lint / Format    | Biome                                                   |
| Package manager  | pnpm                                                    |
| Container        | Docker, multi-stage, Node 20 alpine                     |

Detailed rationale lives in `ROADMAP.md` under "Tech Stack".

## License

[MIT](./LICENSE).
