import "server-only";
import { resolveIdentity } from "../../lib/site/identity";
import { createPublicRuntimeScope } from "../runtime/public-composition";
import type { PublicRuntimeScope } from "../http/public-reading";
import { expectDegraded } from "../logging/failure";

const TTL_MS = 5 * 60_000;
let remembered: { name: string; at: number } | null = null;

/**
 * CRC's product name for public page titles and share cards, read through the public runtime's `productName`
 * (src/server/data/product-name.ts). Static pages ask at build and again each time they regenerate; a failure
 * never reaches a visitor, it falls back and is not remembered.
 */
export async function readPublicProductName(scope?: PublicRuntimeScope, now: () => number = Date.now): Promise<string> {
  // A fork's name comes from its settings, never from the stored tenant row (which keeps CRC's internal id and name).
  const identity = resolveIdentity();
  if (!identity.crc) return identity.productName;
  if (remembered && now() - remembered.at < TTL_MS) return remembered.name;
  try {
    const found: { name: string | null } = { name: null };
    // A failure here falls back to the configured name by design: it is written at the warn level (stdout), never
    // through console.error, which a server component in `next dev` would replay into the browser's dev overlay.
    await expectDegraded(() => (scope ?? createPublicRuntimeScope())(async runtime => { found.name = await runtime.productName(); return new Response(null); }));
    const name = found.name;
    if (typeof name === "string" && name.trim() !== "") { remembered = { name, at: now() }; return name; }
  } catch { /* Fall through to the default. */ }
  return identity.productName;
}
export function forgetPublicProductName() { remembered = null; }
