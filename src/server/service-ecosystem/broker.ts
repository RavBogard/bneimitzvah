import "server-only";
import { AccessUnavailable } from "../access/errors";
import type { MusicBroker, MusicProjection, MusicResult, MusicRow } from "./contract";

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AccessUnavailable();
  return value as Record<string, unknown>;
};
const string = (value: unknown, max = 256): string => {
  if (typeof value !== "string" || !value.length || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw new AccessUnavailable();
  return value;
};
const optional = (value: unknown, max?: number) => value === undefined ? undefined : string(value, max);
function safeUrl(value: unknown, origin: string) {
  const url = new URL(string(value, 2048));
  if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password) throw new AccessUnavailable();
  return url.href;
}
export function parseMusicResult(value: unknown, origin: string): MusicResult {
  const result = object(value);
  if (result.version !== 1) throw new AccessUnavailable();
  if (result.status === "review_required" && result.projection === undefined) return { version: 1, status: "review_required", setlistId: optional(result.setlistId, 128), sourceRevision: optional(result.sourceRevision) };
  if (result.status === "ambiguous") {
    if (!Array.isArray(result.candidates) || result.candidates.length > 100) throw new AccessUnavailable();
    return { version: 1, status: "ambiguous", candidates: result.candidates.map(v => ({ setlistId: string(object(v).setlistId, 128) })) };
  }
  if (result.status !== "linked" && result.status !== "review_required") throw new AccessUnavailable();
  const p = object(result.projection);
  if (!Array.isArray(p.rows) || p.rows.length > 256 || !/^\d{4}-\d{2}-\d{2}$/.test(string(p.localDate)) || !["morning", "havdalah"].includes(String(p.ceremonyType))) throw new AccessUnavailable();
  const seen = new Set<string>();
  const rows: MusicRow[] = p.rows.map(value => {
    const row = object(value), rowId = string(row.rowId, 128);
    if (seen.has(rowId) || !Number.isSafeInteger(row.order) || Number(row.order) < 0 || !Array.isArray(row.resources) || row.resources.length > 20) throw new AccessUnavailable();
    seen.add(rowId);
    const arrangement = row.arrangement === undefined ? undefined : object(row.arrangement);
    const liturgy = row.liturgyRef === undefined ? undefined : object(row.liturgyRef);
    if (liturgy && (!Number.isSafeInteger(liturgy.folio) || Number(liturgy.folio) < 1)) throw new AccessUnavailable();
    return { rowId, order: Number(row.order), title: string(row.title), prayerId: optional(row.prayerId, 200),momentId:optional(row.momentId,200),
      catalogUnitId: optional(row.catalogUnitId, 200), biblicalRef: optional(row.biblicalRef), edition: optional(row.edition), textIdentity: optional(row.textIdentity),
      sharedDirections: optional(row.sharedDirections, 2000),
      ...(liturgy ? { liturgyRef: { book: string(liturgy.book), folio: Number(liturgy.folio), unitId: optional(liturgy.unitId, 200), serviceViewId: optional(liturgy.serviceViewId, 200) } } : {}),
      ...(arrangement ? { arrangement: { songId: optional(arrangement.songId, 128), fileId: optional(arrangement.fileId, 128), key: optional(arrangement.key, 64) } } : {}),
      resources: row.resources.map(value => { const r = object(value); if (r.kind !== "score" && r.kind !== "audio") throw new AccessUnavailable(); return { resourceId: string(r.resourceId, 128), kind: r.kind, label: string(r.label) }; }),
    };
  });
  const projection: MusicProjection = { setlistId: string(p.setlistId, 128), sourceRevision: string(p.sourceRevision), localDate: p.localDate as string,
    ceremonyType: p.ceremonyType as MusicProjection["ceremonyType"], rows: result.status === "linked" ? rows.sort((a, b) => a.order - b.order) : [], operatorLinks: { music: safeUrl(object(p.operatorLinks).music, origin),
      ...(object(p.operatorLinks).review === undefined ? {} : { review: safeUrl(object(p.operatorLinks).review, origin) }) } };
  if (result.setlistId !== projection.setlistId || result.sourceRevision !== projection.sourceRevision) throw new AccessUnavailable();
  return { version: 1, status: result.status, setlistId: projection.setlistId, sourceRevision: projection.sourceRevision, projection };
}
export function createMusicBroker(config: { url: string; token: string } | undefined, fetcher: typeof fetch = fetch): MusicBroker {
  async function post(body: Record<string, unknown>, signal?:AbortSignal) {
    if (!config || config.token.length < 32) throw new AccessUnavailable();
    const endpoint = new URL(config.url);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/api/integrations/beit-mitzvah/v1") throw new AccessUnavailable();
    const response = await fetcher(endpoint.href, { method: "POST", headers: { authorization: `Bearer ${config.token}`, "x-org-id":"crc", "content-type": "application/json" },
      body: JSON.stringify({ version: 1, orgId: "crc", ...body }), cache: "no-store", redirect: "error", signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000) });
    if (!response.ok || !response.body) throw new AccessUnavailable();
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
    try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.length; if (length > 160_000) throw new AccessUnavailable(); chunks.push(chunk.value); } }
    finally { await reader.cancel().catch(() => undefined); }
    return { result: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown, origin: endpoint.origin };
  }
  async function result(body: Record<string, unknown>,signal?:AbortSignal) { const value = await post(body,signal); return parseMusicResult(value.result, value.origin); }
  return {
    ensure: (input,signal) => result({ operation: "ensure", ...input },signal),
    projection: (ceremonyId,signal) => result({ operation: "projection", ceremonyId },signal),
    resource: async (ceremonyId, rowId, resourceId) => {
      const { result, origin } = await post({ operation: "resource", ceremonyId, rowId, resourceId });
      const envelope = object(result), r = object(envelope.resource), expiresAt = string(r.expiresAt);
      const expiry = Date.parse(expiresAt);
      if (envelope.version !== 1 || r.resourceId !== resourceId || (r.kind !== "audio" && r.kind !== "score") || !Number.isFinite(expiry) || expiry <= Date.now() || expiry > Date.now() + 5 * 60_000) throw new AccessUnavailable();
      return { resourceId, kind: r.kind, url: safeUrl(r.url, origin), expiresAt };
    },
  };
}
