import { PortalRequestError } from "../../api";
import type { HonorsState } from "./owner";
import { captureLinkIntent, HonoreeClientError, type HonoreeClient, type LinkIntent, type LinkRecord } from "./honoree-api";

export type HonoreeState = Readonly<{ phase: "ready" | "status" | "mutating" | "checking" | "unknown" | "disposed"; records: Readonly<Record<string, LinkRecord | null>>; pending: LinkIntent | null; confirmation: Readonly<{ operation: "reissue" | "revoke"; startVerse: string }> | null; secret: Readonly<{ startVerse: string; url: string }> | null; scope: string | null; message: string | null; copied: boolean }>;
/** A separate memory owner/UUID stream. Status never adopts an honors draft,
 * and neither receipts nor retries recover a lost plaintext credential. */
export function createHonoreeOwner(api: HonoreeClient, input: { honors(): HonorsState | null; blocked(): boolean; changed(state: HonoreeState): void }, newId = () => crypto.randomUUID()) {
  let state: HonoreeState = Object.freeze({ phase: "ready", records: {}, pending: null, confirmation: null, secret: null, scope: null, message: null, copied: false });
  let disposed = false, paused = false, turn = 0, request: AbortController | undefined, settling: Promise<unknown> = Promise.resolve();
  const publish = (patch: Partial<HonoreeState>) => { if (!disposed) { state = Object.freeze({ ...state, ...patch }); input.changed(state); } };
  const busy = () => ["status", "mutating", "checking"].includes(state.phase);
  const uncertain = () => !!state.pending;
  const idle = () => !disposed && !paused && !busy() && !input.blocked() && !input.honors()?.pending && !["saving", "checking", "unknown", "disposed", "loading", "unavailable"].includes(input.honors()?.phase ?? "loading");
  function canIssue(startVerse: string) {
    const h = input.honors(), c = h?.current, saved = c?.saved, context = c?.currentContext;
    return idle() && !state.pending && !!h && h.phase === "ready" && !h.dirty && h.reviewed && !!saved && !c!.needsReview && saved.version === c!.currentVersion && h.baseVersion === saved.version
      && saved.reviewedContext.hash === context!.hash && h.draftContext?.hash === context!.hash && context!.status === "assigned" && !context!.unknownSlot && !context!.readingNeedsReview
      && !!context!.snapshot.torah && context!.snapshot.torah.cuts !== null && !context!.snapshot.torah.confirmation.needsReview
      && context!.spans.some(s => s.startVerse === startVerse) && !!saved.form.aliyot.find(g => g.startVerse === startVerse)?.participants.length;
  }
  const known = (startVerse: string) => Object.hasOwn(state.records, startVerse);
  function canRevoke(startVerse: string) { return idle() && !state.pending && !!state.records[startVerse] && !!input.honors()?.current?.saved; }
  function clear() { if (disposed) return; ++turn; request?.abort(); publish({ phase: "disposed", records: {}, pending: null, confirmation: null, secret: null, message: null, copied: false }); disposed = true; }
  function denied(error: unknown) { if (error instanceof PortalRequestError && [401, 403].includes(error.status)) { clear(); return true; } return false; }
  function pause() {
    if (disposed) return; paused = true; ++turn; request?.abort();
    publish({ phase: state.pending ? "unknown" : "ready", secret: null, confirmation: null, copied: false, ...(state.pending ? { message: "The link operation is unconfirmed. Check its original receipt before continuing." } : {}) });
  }
  async function status(startVerse: string) {
    if (!idle() || state.pending) return false;
    const mine = ++turn, controller = new AbortController(); request = controller;
    publish({ phase: "status", scope: startVerse, secret: null, confirmation: null, message: null, copied: false });
    const task = (async () => { try {
      const record = await api.status(startVerse, controller.signal); if (disposed || paused || mine !== turn || controller.signal.aborted) return false;
      publish({ phase: "ready", records: Object.freeze({ ...state.records, [startVerse]: record }), message: record ? "A link record was found. This does not confirm that the link is usable." : "No current link record was found." }); return true;
    } catch (error) { if (!disposed && mine === turn && !controller.signal.aborted && !denied(error)) publish({ phase: "ready", records: {}, secret: null, message: "Blessing links are unavailable here. No link validity was confirmed." }); return false;
    } })(); settling = task; return task;
  }
  async function dispatch(check: boolean) {
    if (!idle() || !state.pending) return false;
    const intent = state.pending, wasUnknown = state.phase === "unknown", mine = ++turn, controller = new AbortController(); request = controller;
    publish({ phase: check ? "checking" : "mutating", secret: null, confirmation: null, message: null, copied: false });
    const task = (async () => { try {
      const value = await (check ? api.receipt(intent, controller.signal) : api.mutate(intent, controller.signal));
      if (disposed || paused || mine !== turn || controller.signal.aborted) return false;
      if (value.outcome === "unconfirmed") { publish({ phase: "unknown", message: "No committed receipt was found. The original action may still complete. Check again or retry that same action." }); return false; }
      if (value.operation !== intent.operation || value.startVerse !== intent.startVerse || intent.operation === "revoke" && value.linkId !== intent.linkId) throw new HonoreeClientError();
      const record: LinkRecord | null = intent.operation === "revoke" ? null : { id: value.linkId, startVerse: intent.startVerse, issuedAt: null, expiresAt: value.expiresAt ?? null };
      const secret = !check && !wasUnknown && !value.replayed && value.url ? Object.freeze({ startVerse: intent.startVerse, url: value.url }) : null;
      publish({ phase: "ready", pending: null, records: Object.freeze({ ...state.records, [intent.startVerse]: record }), secret, message: intent.operation === "revoke" ? "The recorded link was revoked." : secret ? "Copy this link now. Its full URL cannot be recovered from the record or receipt." : "The action was confirmed. Its full URL cannot be recovered; explicitly replace the recorded link if a new URL is needed." }); return true;
    } catch (error) {
      if (disposed || paused || mine !== turn || controller.signal.aborted || denied(error)) return false;
      if (!wasUnknown && !check && error instanceof HonoreeClientError && error.definite) publish({ phase: "ready", pending: null, records: {}, secret: null, message: "The saved form or link record changed. Check the record and saved form before trying a new action." });
      else publish({ phase: "unknown", records: {}, secret: null, message: error instanceof PortalRequestError && error.status === 404 ? "Blessing links are unavailable here. The original action is unconfirmed; keep its receipt controls to reconcile it." : "The link action could not be confirmed. Check its original receipt or deliberately retry the same action." }); return false;
    } })(); settling = task; return task;
  }
  function issue(startVerse: string) {
    if (!canIssue(startVerse) || !known(startVerse) || state.records[startVerse] !== null) return Promise.resolve(false);
    return begin("issue", startVerse);
  }
  function begin(operation: LinkIntent["operation"], startVerse: string) {
    const current = input.honors()!.current!;
    const intent = captureLinkIntent({ operation, startVerse, mutationId: newId(), expectedVersion: current.currentVersion, contextHash: current.currentContext.hash, linkId: operation === "issue" ? null : state.records[startVerse]!.id });
    publish({ pending: intent, scope: startVerse, secret: null, confirmation: null, copied: false }); return dispatch(false);
  }
  function confirm(operation: "reissue" | "revoke", startVerse: string) {
    if (operation === "revoke" ? !canRevoke(startVerse) : !canIssue(startVerse) || !state.records[startVerse]) return false;
    publish({ scope: startVerse, secret: null, copied: false, confirmation: Object.freeze({ operation, startVerse }) }); return true;
  }
  async function copy(write: (value: string) => Promise<void>) {
    if (!idle() || !state.secret || state.pending) return false;
    const secret = state.secret, mine = turn;
    try { await write(secret.url); if (disposed || paused || mine !== turn || state.secret !== secret) return false; publish({ copied: true, message: "Link copied. Share it only with the person invited to this aliyah." }); return true; }
    catch { if (!disposed && !paused && mine === turn && state.secret === secret) publish({ message: "Copy was unavailable. Select the read-only URL and copy it explicitly." }); return false; }
  }
  return Object.freeze({ get state() { return state; }, busy, uncertain, canIssue, canRevoke, known, status, issue, confirm, copy, pause, clear,
    hideSecret() { ++turn; publish({ secret: null, confirmation: null, copied: false }); },
    resume() { if (!disposed) paused = false; },
    cancelConfirmation() { publish({ confirmation: null }); },
    acceptConfirmation() { const c = state.confirmation; if (!c || (c.operation === "revoke" ? !canRevoke(c.startVerse) : !canIssue(c.startVerse) || !state.records[c.startVerse])) return Promise.resolve(false); return begin(c.operation, c.startVerse); },
    check() { return state.phase === "unknown" ? dispatch(true) : Promise.resolve(false); }, retry() { return state.phase === "unknown" ? dispatch(false) : Promise.resolve(false); },
    settle() { return settling.then(() => undefined); } });
}
export type HonoreeOwner = ReturnType<typeof createHonoreeOwner>;
