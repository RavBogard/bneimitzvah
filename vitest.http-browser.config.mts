import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/http-browser/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    env: { HTTP_BROWSER_TEST: "1", BETTER_AUTH_URL: "http://localhost:3000" },
  },
});
