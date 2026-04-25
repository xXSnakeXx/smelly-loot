# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and
this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Pending for v1.0.0
- Loot distribution UI: weeks, boss kills, per-drop recommendations, accept/override flow
- Material tally (Glaze / Twine / Ester counters with page-aware effective need)
- Pages counter (auto-derived spent / current / needed per floor with page_adjust)
- History views (per-player gear timeline + per-week loot grid)
- Tier-edit form
- DE/EN translation parity sweep + dark-mode polish

## [0.1.0] - 2026-04-25

The first interim milestone after Phase 0. Substantial groundwork
for the MVP — every Phase 1 *foundation* (schema, players, BiS,
scoring engine) is in place. The loot-distribution UI itself comes
in v1.0.0.

### Added

#### Documentation & decisions
- `ROADMAP.md` records the closed status of all seven Phase 1
  discussion topics with their per-decision blocks (DPS preference,
  pages tracking, Floor 4 behaviour, Glaze/Twine/Ester, BiS source
  granularity, recommendation display, tier rollover).

#### Database & domain
- Full Phase 1 schema across nine tables (`team`, `player`,
  `bis_choice`, `tier`, `floor`, `tier_buy_cost`, `raid_week`,
  `boss_kill`, `loot_drop`, `page_adjust`).
- First-boot seed installs the team `Mannschaft Smelly` and the
  active Heavyweight tier with floor layout, source iLvs (max 795),
  the canonical `tier_buy_cost` lookup (Earring 3, Head 4, Body 6,
  Weapon 8, Glaze 3, Twine 4, Ester 4), and floor-4
  `tracked_for_algorithm = false`.

#### UI
- Persistent site header (brand, five-tab nav, locale switcher,
  theme toggle).
- Dashboard: live team + tier card, quick-actions list.
- Team-settings page (`/team`) with rename + default locale.
- Player CRUD (`/players`): empty state, table with role badges,
  create/edit dialog (job picker grouped by role), delete
  confirmation.
- Per-player BiS tracker (`/players/[id]`): twelve-row gear table
  with desired-source / current-source / marker dropdowns, inline
  iLv display, auto-save on change, row colours signalling BiS
  progress.

#### Algorithm
- `src/lib/loot/algorithm.ts` — pure-function scoring engine over
  plain data. Implements every term in the roadmap:
  - page-aware `effective_need` (Topic 2)
  - class-aware role weights (Topic 1)
  - same engine for upgrade materials (Topic 4)
  - sorted-highest-first output (Topic 6)
  - tiebreaker on oldest last-drop, then deterministic hash
- 12 fixture-driven Vitest cases prove the contract.

#### Plumbing
- Routes touching the database are `force-dynamic` so live state
  doesn't go stale behind a prerender.
- date-fns added for locale-aware date formatting.
- Zod 4 added for shared client/server validation; shadcn `alert`,
  `alert-dialog`, `badge`, `textarea` components added.

### Tests
36 unit tests passing (3 utils + 11 jobs + 10 slots + 12 algorithm).

## [0.0.1] - 2026-04-25

Phase 0 (project setup) of the [roadmap](./ROADMAP.md).

### Added
- **Next.js 16 + React 19 + Tailwind v4 scaffold** with the App Router,
  the `src/` layout, pnpm as the package manager, and Biome as the
  unified lint/format toolchain.
- **TypeScript strict mode** with `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`, and
  `noFallthroughCasesInSwitch` enabled.
- **shadcn/ui** integrated on the new base-nova preset (Base UI
  primitives, neutral palette). Components shipped at this stage:
  button, card, dialog, input, label, select, sonner (toaster), table.
- **Theme + toast providers** wired into the root layout with
  next-themes (system-following dark mode) and Sonner.
- **Drizzle ORM + libSQL** with the initial `team` table and a
  programmatic migrator wired into `src/instrumentation.ts` so a fresh
  database is migrated automatically on server boot.
- **next-intl** with German and English locales, locale-prefixed URLs
  (`/en`, `/de`), the v16 `proxy.ts` file convention, type-safe
  navigation helpers, and a locale switcher component.
- **Vitest** unit suite (jsdom + Testing Library + jest-dom) and a
  **Playwright** end-to-end skeleton with a smoke test that walks the
  proxy, the `[locale]` route segment, and the German/English content.
- **Multi-stage Dockerfile** producing a Next.js standalone image
  (~245 MB) running as `node` (uid 1000), with a HEALTHCHECK against
  `/`, the SQLite path on a volume, and migrations applied at boot.
- **docker-compose.yml** for one-command self-hosting.
- **README** with a quick-start, local-development guide, project
  layout, and tech-stack overview.

### Repository hygiene
- MIT-licensed under the team's GitHub noreply identity.
- `.env.example` documents `DATABASE_URL` and the optional auth token
  for remote libSQL.
- Biome ignores generated `drizzle/` migration metadata so its
  formatter doesn't fight drizzle-kit on every schema change.
