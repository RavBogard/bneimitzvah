import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import { AccessDenied } from "../access/errors";
import type { AccessDatabase, AccessRequest, DeploymentScope } from "../access/types";
import { lookupTenantHost } from "../data/tenant-hosts";
import { createLogger, hostDenialEvent, type HostDenialStage, type HostFrame } from "../logging/logger";

function authority(value: string, scheme: string) {
  // DNS/IPv4 plus explicit port only. No credentials, percent decoding, Unicode
  // host tricks, empty labels, trailing dots, IPv6 ambiguity or proxy lists.
  if (!/^[a-zA-Z0-9.-]+(?::[0-9]{1,5})?$/.test(value)) throw new AccessDenied(404);
  const url = new URL(`${scheme}//${value}`);
  if (url.hostname.length > 253 || !url.hostname.split(".").every((label) => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label))) throw new AccessDenied(404);
  return url.host;
}

// Deliberately bounded RFC7239 subset: one element, four known parameters,
// token/simple quoted values, and no escapes/extensions. This is a consistency
// check only. The URL, Host and directory remain authoritative; for/by are
// opaque syntax and never become identity, address, tenant or limiter inputs.
function consistentForwarded(value: string, host: string, scheme: string): boolean {
  if (!value || value.length > 1024 || /[^\x09\x20-\x7e]|,|\\/.test(value)) return false;
  const token = /^[!#$%&'*+\-.^_\x60|~A-Za-z0-9]+/;
  const names = new Set<string>();
  let position = 0;
  const whitespace = () => { while (value[position] === " " || value[position] === "\t") position++; };
  while (position < value.length) {
    whitespace();
    const nameMatch = token.exec(value.slice(position));
    if (!nameMatch) return false;
    const name = nameMatch[0].toLowerCase(); position += nameMatch[0].length;
    if (!["host", "proto", "for", "by"].includes(name) || names.has(name) || names.size >= 4 || value[position++] !== "=") return false;
    names.add(name);
    let part: string;
    if (value[position] === '"') {
      const start = ++position;
      while (position < value.length && value[position] !== '"') position++;
      if (position === value.length) return false;
      part = value.slice(start, position++);
    } else {
      const match = token.exec(value.slice(position));
      if (!match) return false;
      part = match[0]; position += part.length;
    }
    if (!part) return false;
    if (name === "host" && authority(part, scheme) !== host) return false;
    if (name === "proto" && part !== scheme.slice(0, -1)) return false;
    if ((name === "for" || name === "by") && !/^[A-Za-z0-9_.:[\]-]{1,256}$/.test(part)) return false;
    whitespace();
    if (position === value.length) return true;
    if (value[position++] !== ";" || position === value.length) return false;
  }
  return false;
}

export async function resolveTenantHost<Q extends PgQueryResultHKT>(db: AccessDatabase<Q>, request: AccessRequest, scope: DeploymentScope, frame: HostFrame = "service") {
  let stage: HostDenialStage = "scope";
  try {
    if (!scope.deployment || scope.deployment.trim() !== scope.deployment || !["production", "preview", "local", "test"].includes(scope.environment)) throw new AccessDenied(404);
    stage = "url";
    if (/[\s\\\u0000-\u001f\u007f]/.test(request.url)) throw new AccessDenied(404);
    const match = /^(https?):\/\/([^/?#]+)(?:[/?#]|$)/.exec(request.url);
    if (!match) throw new AccessDenied(404);
    const url = new URL(request.url);
    stage = "url-authority";
    const host = authority(match[2], url.protocol);
    if (url.hash || url.username || url.password || url.host !== host) throw new AccessDenied(404);
    stage = "scheme";
    const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(loopback && ["local", "test"].includes(scope.environment))) throw new AccessDenied(404);
    if (loopback && ["production", "preview"].includes(scope.environment)) throw new AccessDenied(404);
    stage = "host";
    const suppliedHost = request.headers.get("host");
    if (suppliedHost !== null && (!suppliedHost || authority(suppliedHost, url.protocol) !== host)) throw new AccessDenied(404);
    // Forwarded headers are consistency checks only; none selects a tenant.
    stage = "forwarded";
    const forwarded = request.headers.get("forwarded");
    if (forwarded !== null && !consistentForwarded(forwarded, host, url.protocol)) throw new AccessDenied(404);
    stage = "forwarded-host";
    const forwardedHost = request.headers.get("x-forwarded-host");
    if (forwardedHost !== null && (!forwardedHost || authority(forwardedHost, url.protocol) !== host)) throw new AccessDenied(404);
    stage = "forwarded-proto";
    const forwardedProtocol = request.headers.get("x-forwarded-proto");
    if (forwardedProtocol !== null && forwardedProtocol !== url.protocol.slice(0, -1)) throw new AccessDenied(404);
    stage = "forwarded-port";
    const forwardedPort = request.headers.get("x-forwarded-port");
    if (forwardedPort !== null && forwardedPort !== (url.port || (url.protocol === "https:" ? "443" : "80"))) throw new AccessDenied(404);
    stage = "directory-query";
    const mapping = await lookupTenantHost(db, host, url.origin, scope);
    stage = "directory-missing";
    if (!mapping) throw new AccessDenied(404);
    return Object.freeze({ tenantId: mapping.tenantId, origin: url.origin });
  } catch {
    // No raw host, URL, header, directory row or database error in denials.
    try {
      const event = hostDenialEvent(frame, stage);
      if (event) createLogger().request().emit(event, 404);
    } catch { /* Diagnostic construction cannot change the existing denial. */ }
    throw new AccessDenied(404);
  }
}
