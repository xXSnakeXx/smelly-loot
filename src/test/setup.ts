/**
 * Vitest setup file.
 *
 * Registers the @testing-library/jest-dom matchers (`toBeInTheDocument`,
 * `toHaveAttribute`, …) and any other globals our tests need. Loaded
 * automatically before each test file via `vitest.config.mts`.
 */
import "@testing-library/jest-dom/vitest";
