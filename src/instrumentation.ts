/**
 * Next.js instrumentation hook.
 *
 * Runs once per server instance, before any request is handled. We
 * use it for two boot-time housekeeping steps that should be invisible
 * to operators:
 *
 * 1. Apply pending Drizzle migrations so the database schema always
 *    matches the deployed code — no separate migration step in CI/CD,
 *    no manual `pnpm db:migrate` after each deploy.
 *
 * 2. Idempotently seed the default team and the active raid tier so a
 *    fresh deployment lands on a usable dashboard rather than a 404.
 *
 * The hook is a no-op outside the Node.js runtime (e.g. the Edge
 * runtime used by the proxy), since neither @libsql/client nor
 * drizzle-orm/libsql/migrator can run there. Wrapping the imports
 * dynamically also keeps the Edge bundle from accidentally pulling in
 * Node-only dependencies.
 *
 * If either step fails the server intentionally crashes; a half-
 * migrated database or a missing seed is far worse than a noisy boot
 * loop, and the migration table itself prevents re-applying steps
 * that already succeeded.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const [{ migrate }, dbModule, path] = await Promise.all([
    import("drizzle-orm/libsql/migrator"),
    import("@/lib/db"),
    import("node:path"),
  ]);

  const migrationsFolder = path.join(process.cwd(), "drizzle");

  console.log(`[instrumentation] applying migrations from ${migrationsFolder}`);
  await migrate(dbModule.db, { migrationsFolder });
  console.log("[instrumentation] migrations applied");

  await dbModule.ensureSeedData();
}
