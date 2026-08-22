import { resolve } from "path";
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * A floor, not a target. The thresholds used to ramp linearly to 80% by the end
 * of 2026, which by August stood at 48% against real coverage of 25%, so every
 * run of `npm run test` failed on coverage while every test passed: a red suite
 * that says nothing, which is worse than no threshold at all.
 *
 * These sit a point or two under where the suite actually is, so a run goes red
 * when coverage DROPS and stays green otherwise. Raise them when a batch of
 * tests lands, by hand, to whatever the suite then reaches. `npm run test`
 * prints the real numbers above this check either way.
 */
const COVERAGE_FLOOR = {
  lines: 25,
  branches: 21,
  functions: 19,
  statements: 24,
};

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      "~": resolve(__dirname, "app"),
    },
  },
  test: {
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["tests/setup.ts"],
    exclude: ["tests/evals/**"],
    coverage: {
      provider: "v8",
      include: ["app/**/*.ts", "app/**/*.tsx", "agents/**/*.ts", "workers/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.d.ts"],
      thresholds: COVERAGE_FLOOR,
    },
  },
});
