/**
 * Next.js instrumentation hook.
 *
 * Runs once per server instance, before any request is handled. We use
 * it to apply pending Drizzle migrations so the database schema always
 * matches the deployed code — no separate migration step in CI/CD, no
 * manual `pnpm db:migrate` after each deploy.
 *
 * The hook is a no-op outside the Node.js runtime (e.g. the Edge
 * runtime used by the proxy), since neither @libsql/client nor
 * drizzle-orm/libsql/migrator can run there. Wrapping the import
 * dynamically also keeps the Edge bundle from accidentally pulling in
 * Node-only dependencies.
 *
 * If the migration fails the server intentionally crashes; a half-
 * migrated database is far worse than a noisy boot loop.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const [{ migrate }, { db }, path] = await Promise.all([
    import("drizzle-orm/libsql/migrator"),
    import("@/lib/db"),
    import("node:path"),
  ]);

  const migrationsFolder = path.join(process.cwd(), "drizzle");

  console.log(`[instrumentation] applying migrations from ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
  console.log("[instrumentation] migrations applied");
}
