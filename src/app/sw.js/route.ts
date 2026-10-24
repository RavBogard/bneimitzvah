import { workerEnvironment, workerSource } from "../../lib/offline/worker-source";

// Built once per deploy. A redeploy with PORTAL_OFFLINE_ENABLED=false serves the tombstone, which removes the app's
// caches and unregisters itself (A's rollback; a 404 would leave an installed worker in place).
export const dynamic = "force-static";

export async function GET() {
  return new Response(await workerSource(workerEnvironment(process.env)), {
    headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=0, must-revalidate", "x-content-type-options": "nosniff" },
  });
}
