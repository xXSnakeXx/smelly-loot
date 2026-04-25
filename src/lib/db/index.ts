/**
 * Public re-exports for the database module.
 *
 * Application code should import from `@/lib/db` rather than reaching
 * into `client.ts` or `schema.ts` directly, so internal restructuring
 * (e.g. splitting the schema into multiple files) stays a no-op for
 * consumers.
 */
export { type Database, db } from "./client";
export * as schema from "./schema";
