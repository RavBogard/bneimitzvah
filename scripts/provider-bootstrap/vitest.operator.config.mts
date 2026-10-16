import { defineConfig } from "vitest/config";

// Deliberately outside ordinary npm test/CI includes; use the scrubbed launcher.
export default defineConfig({ envDir: false, test: { include: ["scripts/provider-bootstrap/neon-ws.operator.test.ts"],
  environment: "node", maxWorkers: 1, fileParallelism: false, passWithNoTests: false,
  testTimeout: 70000, hookTimeout: 10000, reporters: ["dot"] } });
