import { startBuiltE2eServer } from "../tests/helpers/builtE2eServer.mjs";
import { dirname } from "node:path";
import type { FullConfig } from "@playwright/test";

// Playwright's webServer merges its env with the operator's process.env.
// Direct spawning keeps this unconfigured production gate isolated instead.
export default async function setup(config: FullConfig) {
  if (!config.configFile) throw new Error("Production browser gate requires its repository config");
  return startBuiltE2eServer(dirname(config.configFile), 3100);
}
