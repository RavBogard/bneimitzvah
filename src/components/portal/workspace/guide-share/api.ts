import { PortalRequestError } from "../../api";

/** What the guide sharing page shows of a preview or an import. Every field is read defensively: the page renders text only, never markup. */
export type Item = { label: string; status: "ready" | "skipped"; reason: string | null; dropped: number };
export type Outcome =
  | { ok: true; guides: Item[]; summaries: Item[]; discussions: Item[]; authors: string[]; imported: { guides: number; summaries: number } | null }
  | { ok: false; problems: string[] };
const MAX_FILE = 4 * 1024 * 1024;
const bad = (): never => { throw new PortalRequestError(503); };
const text = (value: unknown, max: number) => typeof value === "string" && value.length <= max ? value : bad();
const list = (value: unknown, max: number): unknown[] => Array.isArray(value) && value.length <= max ? value : bad();
const rec = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : bad();
function items(value: unknown, label: (row: Record<string, unknown>) => string): Item[] {
  return list(value, 600).map(raw => {
    const row = rec(raw);
    return { label: label(row), status: row.status === "ready" ? "ready" : "skipped", reason: typeof row.reason === "string" ? text(row.reason, 60) : null,
      dropped: Number.isSafeInteger(row.droppedCitations) ? Number(row.droppedCitations) : 0 };
  });
}
export function parseOutcome(status: number, value: unknown): Outcome {
  const row = rec(value);
  if (status === 400 && row.ok === false) return { ok: false, problems: list(row.problems ?? [], 40).map(p => text(p, 300)) };
  if (status !== 200 || row.ok !== true) return bad();
  const imported = row.imported === undefined ? null : rec(row.imported);
  return { ok: true, authors: list(row.authors, 200).map(a => text(a, 240)),
    guides: items(row.guides, r => `${text(r.kind, 20)}: ${text(r.readingKey, 160)}`), summaries: items(row.summaries, r => text(r.reading, 80)), discussions: items(row.discussions, r => text(r.slug, 80)),
    imported: imported ? { guides: Number(imported.guides) || 0, summaries: Number(imported.summaries) || 0 } : null };
}
async function post(path: string, file: unknown, signal?: AbortSignal): Promise<Outcome> {
  const controller = new AbortController(), abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 120_000);
  try {
    const response = await fetch(path, { method: "POST", body: JSON.stringify({ file }), credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", signal: controller.signal,
      headers: { accept: "application/json", "content-type": "application/json" } });
    if (!response.ok && response.status !== 400) throw new PortalRequestError([401, 403, 404, 413, 429, 503].includes(response.status) ? response.status : 503);
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return bad();
    const body = await response.text();
    if (body.length > 2 * 1024 * 1024) return bad();
    return parseOutcome(response.status, JSON.parse(body));
  } catch (error) { if (error instanceof PortalRequestError) throw error; return bad(); }
  finally { clearTimeout(timeout); signal?.removeEventListener("abort", abort); }
}
export const guideShareApi = {
  exportHref: "/api/admin/guide-share/export",
  maxBytes: MAX_FILE,
  preview: (file: unknown, signal?: AbortSignal) => post("/api/admin/guide-share/preview", file, signal),
  importFile: (file: unknown, signal?: AbortSignal) => post("/api/admin/guide-share/import", file, signal),
};
