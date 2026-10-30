import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

// Installed only as the fake Next executable inside a disposable test project.
const env = process.env;
await writeFile(join(process.cwd(), "lifecycle.json"), JSON.stringify({ home: env.HOME }));
const isolated = env.NODE_ENV === "production" && env.NEXT_TELEMETRY_DISABLED === "1"
  // The gate sets exactly CRC's identity origin itself (builtE2eServer); the inherited synthetic value must be gone.
  && !env.BETTER_AUTH_SECRET && env.BETTER_AUTH_URL === "https://beitmitzvah.centralreform.org" && !env.DATABASE_URL
  && !env.DATABASE_MIGRATION_URL && !env.BOOTSTRAP_OWNER_EMAIL
  && !env.GOOGLE_CLIENT_ID && !env.GOOGLE_CLIENT_SECRET && !env.RESEND_API_KEY
  && !env.PORTAL_ENVIRONMENT && !env.PORTAL_DEPLOYMENT && !env.E2E_POISON
  && env.HOME !== env.E2E_ORIGINAL_HOME;
const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
createServer((_request, response) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ isolated }));
}).listen(port, "127.0.0.1");
