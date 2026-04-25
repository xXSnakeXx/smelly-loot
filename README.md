# Smelly Loot

Self-hosted loot distribution tool for Final Fantasy XIV savage raid statics.
Replaces the team's loot tracker spreadsheet with automated, fair
recommendations per boss kill, plus upgrade-material and gear-progression
tracking.

> **Status — pre-release.** The roadmap and phasing are documented in
> [`ROADMAP.md`](./ROADMAP.md). The first feature-complete milestone is
> `v1.0.0` (Phase 1 in the roadmap). The current head ships only the
> scaffolding required to start building Phase 1 on top.

## Features (planned)

- Team and player management with FF XIV job awareness.
- Per-slot Best-in-Slot tracker that mirrors the team's existing
  spreadsheet workflow (Savage / Tome Up / Tome / Crafted / Relic).
- Automated, transparent loot recommendations per boss kill, with a
  configurable slight DPS preference.
- Upgrade-material accounting (Glaze / Twine / Ester) and pages tally.
- Power-user UI: keyboard shortcuts, command palette, editable data
  grids, dark mode, German + English from day one.

See `ROADMAP.md` for the full scope, phasing, and open discussion
topics.

## Quick Start (Docker)

The recommended deployment path is the bundled Docker image.

```bash
git clone git@github.com:xXSnakeXx/smelly-loot.git
cd smelly-loot
cp .env.example .env
docker compose up -d --build
```

The app is then served at <http://localhost:3000>. Database migrations
apply automatically on container start (via the Next.js instrumentation
hook), and the SQLite file persists in `./data/loot.db`.

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
│   ├── components/           # shared UI components (incl. shadcn/ui)
│   ├── i18n/                 # next-intl routing + request config
│   ├── lib/db/               # Drizzle schema, libSQL client, types
│   ├── instrumentation.ts    # boot-time hook (runs migrations)
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
| Validation       | Zod (added in Phase 1)                                  |
| i18n             | next-intl (DE / EN)                                     |
| Tests            | Vitest (unit) + Playwright (e2e)                        |
| Lint / Format    | Biome                                                   |
| Package manager  | pnpm                                                    |
| Container        | Docker, multi-stage, Node 20 alpine                     |

Detailed rationale lives in `ROADMAP.md` under "Tech Stack".

## License

[MIT](./LICENSE).
