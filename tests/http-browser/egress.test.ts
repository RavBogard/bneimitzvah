import { createServer, type RequestListener, type Server } from "node:http";
import { afterEach, expect, it } from "vitest";
import { installLoopbackFetchGuard } from "./egress";

const servers: Server[] = [];
let restore: (() => void) | undefined;
async function localServer(handler: RequestListener) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Loopback test server unavailable");
  return `http://127.0.0.1:${address.port}`;
}
afterEach(async () => {
  restore?.(); restore = undefined;
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

it("rejects a redirect before fetching its destination", async () => {
  let destinationRequests = 0;
  const destination = await localServer((_req, res) => { destinationRequests++; res.end(); });
  const source = await localServer((_req, res) => { res.writeHead(302, { Location: destination }); res.end(); });
  restore = installLoopbackFetchGuard();
  let rejected = false;
  try { await fetch(source); } catch { rejected = true; }
  expect(rejected && destinationRequests === 0).toBe(true);
  let directDenied = false;
  try { await fetch("https://provider.invalid/"); } catch { directDenied = true; }
  expect(directDenied).toBe(true);
});
