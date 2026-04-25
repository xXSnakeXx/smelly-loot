# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and
this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
