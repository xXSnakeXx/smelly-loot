import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

/**
 * Vitest configuration.
 *
 * Vitest is the project's unit-test runner. Server Components — especially
 * async ones — are exercised end-to-end via Playwright instead, since
 * Vitest can't yet faithfully render the streaming React 19 server tree.
 *
 * Plugins:
 * - `tsconfigPaths` mirrors the `@/*` path alias from tsconfig.json.
 * - `@vitejs/plugin-react` enables JSX/TSX transform with the
 *   automatic runtime, matching what Next.js itself uses.
 *
 * Environment is jsdom so `@testing-library/react` queries work without
 * a real browser. The setup file registers jest-dom matchers
 * (`toBeInTheDocument`, …) globally.
 */
export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
    // Keep the e2e directory off the unit-test runner; Playwright drives
    // those tests through its own runner.
    exclude: ["node_modules", ".next", "dist", "build", "e2e"],
    // Fail loudly when a test references a stale snapshot or has no
    // assertions; the project rules take "tests where possible" seriously.
    passWithNoTests: false,
  },
});
