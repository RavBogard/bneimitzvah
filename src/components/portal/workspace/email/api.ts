import { PortalRequestError } from "../../api";

export type EmailKind = "tutor-draft" | "weekly-digest" | "practice-reminder";
export type EmailOption = { kind: EmailKind; enabled: boolean; offered: boolean; weekday: number | null; audience?: "parent" | "self" | "both" };
const bad = (): never => { throw new PortalRequestError(503); };
const KINDS: readonly EmailKind[] = ["tutor-draft", "weekly-digest", "practice-reminder"];
const weekday = (value: unknown) => value === null || (Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 6);

function parse(value: unknown): EmailOption[] {
  const outer = value as { ok?: unknown; view?: { options?: unknown } } | null;
  if (!outer || outer.ok !== true || !outer.view || typeof outer.view !== "object" || !Array.isArray(outer.view.options) || outer.view.options.length > 3) return bad();
  return outer.view.options.map((option: unknown) => {
    const o = option as Record<string, unknown> | null;
    if (!o || typeof o !== "object" || !KINDS.includes(o.kind as EmailKind) || typeof o.enabled !== "boolean" || typeof o.offered !== "boolean" || !weekday(o.weekday)
      || (o.audience !== undefined && !["parent", "self", "both"].includes(o.audience as string))) return bad();
    return { kind: o.kind as EmailKind, enabled: o.enabled, offered: o.offered, weekday: o.weekday as number | null, ...(o.audience ? { audience: o.audience as EmailOption["audience"] } : {}) };
  });
}
async function request(body?: object, signal?: AbortSignal): Promise<EmailOption[]> {
  const controller = new AbortController(), abort = () => controller.abort(); if (signal?.aborted) abort(); signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 12_000);
  try {
    const response = await fetch("/api/notifications/preferences", { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin", cache: "no-store",
      redirect: "error", referrerPolicy: "no-referrer", signal: controller.signal, headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" } });
    if (!response.ok) throw new PortalRequestError([400, 401, 403, 404, 429, 503].includes(response.status) ? response.status : 503);
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return bad();
    const text = await response.text(); if (text.length > 16 * 1024) return bad();
    return parse(JSON.parse(text));
  } catch (error) { if (error instanceof PortalRequestError) throw error; return bad(); }
  finally { clearTimeout(timeout); signal?.removeEventListener("abort", abort); }
}
export const emailApi = {
  read: (signal?: AbortSignal) => request(undefined, signal),
  save: (choice: { kind: EmailKind; enabled: boolean; weekday?: number }) => request(choice),
};

/** The body the unsubscribe page posts: the token rides in the body, never the URL, so it stays out of request logs. */
export function unsubscribeBody(token: string) {
  return new URLSearchParams([["List-Unsubscribe", "One-Click"], ["t", token]]).toString();
}
/** The unsubscribe page posts the token from its own fragment; the answer says only which kind stopped. */
export async function unsubscribe(token: string): Promise<EmailKind> {
  if (!/^[tdr]\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(token)) throw new PortalRequestError(404);
  const response = await fetch("/api/notifications/unsubscribe", { method: "POST", credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" }, body: unsubscribeBody(token) });
  if (!response.ok) throw new PortalRequestError(response.status === 404 ? 404 : 503);
  const value = await response.json().catch(() => null) as { ok?: unknown; kind?: unknown } | null;
  if (!value || value.ok !== true || !KINDS.includes(value.kind as EmailKind)) throw new PortalRequestError(503);
  return value.kind as EmailKind;
}
