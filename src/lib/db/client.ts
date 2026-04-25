import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "./schema";

/**
 * Single shared libSQL client + Drizzle wrapper used across the app.
 *
 * The connection string defaults to a local SQLite file under `data/`
 * so a fresh checkout works without any env setup. In Docker the same
 * path is a mounted volume so the database file survives container
 * rebuilds. Production deployments can override `DATABASE_URL` to point
 * at a remote Turso instance without touching application code.
 *
 * The module is intentionally side-effect free at import time apart
 * from creating the client; schema migrations are run via `drizzle-kit`
 * (or a future bootstrap script), never implicitly here.
 */
const databaseUrl = process.env.DATABASE_URL ?? "file:./data/loot.db";

const client = createClient({
  url: databaseUrl,
});

export const db = drizzle(client, { schema });

export type Database = typeof db;
