import "dotenv/config";

import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit configuration.
 *
 * Used for generating SQL migrations from the TypeScript schema and for
 * pushing the schema to a database during development. Runtime queries
 * are configured separately in `src/lib/db/client.ts`.
 *
 * `dotenv/config` is imported eagerly so `pnpm db:*` scripts pick up
 * `DATABASE_URL` from `.env` without needing a `dotenv-cli` wrapper.
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "file:./data/loot.db",
  },
  // Surface schema drift loudly during development; CI / production
  // should always run `db:generate` and review the resulting SQL.
  verbose: true,
  strict: true,
});
