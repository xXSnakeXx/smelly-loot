/**
 * Placeholder landing page.
 *
 * Replaced in Phase 1 with the actual dashboard (current raid week, recent
 * drops, gear-tracker shortcuts). For Phase 0 it's intentionally minimal so
 * the build is verifiable without committing to UI decisions.
 */
export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-24 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">Smelly Loot</h1>
      <p className="max-w-md text-sm text-zinc-500 dark:text-zinc-400">
        Self-hosted loot distribution for FF XIV savage raid statics.
        Phase&nbsp;0 scaffold — see{" "}
        <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-xs dark:bg-zinc-900">
          ROADMAP.md
        </code>{" "}
        for the build plan.
      </p>
    </main>
  );
}
