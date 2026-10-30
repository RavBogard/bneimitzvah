import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Migrate once and snapshot the data directory; fixtures clone it instead of re-running every migration.
    globalSetup: ["tests/helpers/pglite-global-setup.ts"],
    include: ["tests/app/**/*.test.ts"],
    environment: "node",
    // CRC's identity needs a positive signal (src/lib/site/identity.ts): tests run as a local CRC.
    env: { BETTER_AUTH_URL: "http://localhost:3000" },
    passWithNoTests: false,
    // Fresh PGlite WASM databases and the pinned auth schema generator contend
    // during cold hosted Windows starts. Bound their parallel memory/CPU use;
    // application fetch deadlines remain independently asserted in tests.
    maxWorkers: 2,
    testTimeout: 20_000,
  },
});
