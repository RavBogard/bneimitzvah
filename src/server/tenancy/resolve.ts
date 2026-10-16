import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import { AccessDenied } from "../access/errors";
import type { AccessDatabase, AccessRequest, DeploymentScope } from "../access/types";
import { lookupTenantHost } from "../data/tenant-hosts";

function authority(value: string, scheme: string) {
  // DNS/IPv4 plus explicit port only. No credentials, percent decoding, Unicode
  // host tricks, empty labels, trailing dots, IPv6 ambiguity or proxy lists.
  if (!/^[a-zA-Z0-9.-]+(?::[0-9]{1,5})?$/.test(value)) throw new AccessDenied(404);
  const url = new URL(`${scheme}//${value}`);
  if (url.hostname.length > 253 || !url.hostname.split(".").every((label) => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label))) throw new AccessDenied(404);
  return url.host;
}

export async function resolveTenantHost<Q extends PgQueryResultHKT>(db: AccessDatabase<Q>, request: AccessRequest, scope: DeploymentScope) {
  try {
    if (!scope.deployment || scope.deployment.trim() !== scope.deployment || !["production", "preview", "local", "test"].includes(scope.environment)) throw new AccessDenied(404);
    if (/[\s\\\u0000-\u001f\u007f]/.test(request.url)) throw new AccessDenied(404);
    const match = /^(https?):\/\/([^/?#]+)(?:[/?#]|$)/.exec(request.url);
    if (!match) throw new AccessDenied(404);
    const url = new URL(request.url);
    const host = authority(match[2], url.protocol);
    if (url.hash || url.username || url.password || url.host !== host) throw new AccessDenied(404);
    const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(loopback && ["local", "test"].includes(scope.environment))) throw new AccessDenied(404);
    if (loopback && ["production", "preview"].includes(scope.environment)) throw new AccessDenied(404);
    const suppliedHost = request.headers.get("host");
    if (suppliedHost !== null && (!suppliedHost || authority(suppliedHost, url.protocol) !== host)) throw new AccessDenied(404);
    // Forwarded headers are consistency checks only; none selects a tenant.
    if (request.headers.has("forwarded")) throw new AccessDenied(404);
    const forwardedHost = request.headers.get("x-forwarded-host");
    if (forwardedHost !== null && (!forwardedHost || authority(forwardedHost, url.protocol) !== host)) throw new AccessDenied(404);
    const forwardedProtocol = request.headers.get("x-forwarded-proto");
    if (forwardedProtocol !== null && forwardedProtocol !== url.protocol.slice(0, -1)) throw new AccessDenied(404);
    const forwardedPort = request.headers.get("x-forwarded-port");
    if (forwardedPort !== null && forwardedPort !== (url.port || (url.protocol === "https:" ? "443" : "80"))) throw new AccessDenied(404);
    const mapping = await lookupTenantHost(db, host, url.origin, scope);
    if (!mapping) throw new AccessDenied(404);
    return Object.freeze({ tenantId: mapping.tenantId, origin: url.origin });
  } catch {
    // No raw host, URL, header, directory row or database error in denials.
    throw new AccessDenied(404);
  }
}
