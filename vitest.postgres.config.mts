import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/postgres/**/*.integration.ts"],
    environment: "node",
    passWithNoTests: false,
    maxWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 15_000,
  },
});
