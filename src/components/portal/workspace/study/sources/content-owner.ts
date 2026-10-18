import { PortalRequestError } from "../../../api";
import { captureEditionChoice, captureEditionPage, eligibleSourceEdition, isSourceMissing, SourceContentError, type EditionChoice, type EditionPageRequest, type SourceContentClient, type SourceContentErrorCode, type SourceEditionPage, type SourceContent } from "./content-api";
export type SourceContentState = Readonly<{ phase: "closed" | "loading-editions" | "editions" | "loading-text" | "text" | "held" | "unavailable" | "stale" | "disposed"; page: SourceEditionPage | null; choice: EditionChoice | null; text: SourceContent | null; error: SourceContentErrorCode | null }>;
export function createSourceContentOwner(input: { api: SourceContentClient; onChange?(state: SourceContentState): void }) {
  let state: SourceContentState = Object.freeze({ phase: "closed", page: null, choice: null, text: null, error: null }), disposed = false, turn = 0, active: AbortController | undefined;
  const seen = new Map<string, { offset: number; signature: string }>(); let catalog: string | null = null, facts: string | null = null, retry: (() => Promise<boolean>) | undefined;
  const publish = (patch: Partial<SourceContentState>) => { if (!disposed) { state = Object.freeze({ ...state, ...patch }); input.onChange?.(state); } };
  function cancel() { turn++; active?.abort(); active = undefined; }
  function error(caught: unknown) {
    if (!isSourceMissing(caught) && caught instanceof PortalRequestError && [401, 403, 404].includes(caught.status)) { dispose(); return; }
    const code = caught instanceof SourceContentError ? caught.code : "unavailable";
    const stale = caught instanceof PortalRequestError && caught.status === 409;
    if (stale) { seen.clear(); catalog = facts = null; retry = undefined; publish({ phase: "stale", page: null, choice: null, text: null, error: code }); }
    else publish({ phase: isSourceMissing(caught) || code === "unsupported-source" || code === "unsupported-edition" ? "held" : "unavailable", text: null, choice: code === "unsupported-source" ? null : state.choice, error: code });
  }
  async function run(phase: "loading-editions" | "loading-text", task: (signal: AbortSignal) => Promise<Partial<SourceContentState>>) {
    if (disposed || state.phase === "stale") return false; cancel(); const mine = turn, request = new AbortController(); active = request; publish({ phase, text: null, error: null });
    try { const patch = await task(request.signal); if (disposed || mine !== turn || request.signal.aborted) return false; publish(patch); return true; }
    catch (caught) { if (!disposed && mine === turn && !request.signal.aborted) error(caught); return false; }
  }
  async function page(supplied: EditionPageRequest): Promise<boolean> {
    const request = captureEditionPage(supplied); retry = () => page(request);
    return run("loading-editions", async signal => {
      const next = await input.api.editions(request, signal); if (signal.aborted) throw new PortalRequestError(409); const currentFacts = JSON.stringify([next.totalEntries, next.receivedRows, next.heldCount, next.duplicateCount]);
      if (catalog !== null && next.editionCatalogHash !== catalog || facts !== null && currentFacts !== facts) throw new SourceContentError(409, "edition-catalog-changed");
      const updates: [string, { offset: number; signature: string }][] = [], pageKeys = new Set<string>();
      for (const e of next.entries) { const key = JSON.stringify([e.versionTitle, e.language]), signature = JSON.stringify(e), old = seen.get(key); if (pageKeys.has(key)) throw new SourceContentError(); pageKeys.add(key); if (old && (old.offset !== next.editionOffset || old.signature !== signature)) throw new SourceContentError(); updates.push([key, { offset: next.editionOffset, signature }]); }
      if (seen.size + updates.filter(([key]) => !seen.has(key)).length > 512) throw new SourceContentError();
      catalog = next.editionCatalogHash; facts = currentFacts; for (const [key, value] of updates) seen.set(key, value);
      return { phase: "editions", page: next, choice: null, error: null };
    });
  }
  async function choose(supplied: EditionChoice) {
    const choice = captureEditionChoice(supplied), current = state.page;
    if (!current || choice.editionCatalogHash !== current.editionCatalogHash || !current.entries.some(e => eligibleSourceEdition(e) && JSON.stringify(e) === JSON.stringify(choice.edition))) return false;
    retry = () => choose(choice); publish({ choice });
    return run("loading-text", async signal => ({ phase: "text", text: await input.api.text(choice, signal), choice, error: null }));
  }
  function clear() { if (disposed) return; cancel(); seen.clear(); catalog = facts = null; retry = undefined; publish({ phase: "closed", page: null, choice: null, text: null, error: null }); }
  function dispose() { if (disposed) return; clear(); publish({ phase: "disposed" }); disposed = true; }
  return Object.freeze({ get state() { return state; }, open: () => page({ editionOffset: 0 }), page, choose,
    retry: () => retry?.() ?? Promise.resolve(false), back() { if (!disposed && state.phase !== "stale") { cancel(); publish({ phase: state.page ? "editions" : "closed", choice: null, text: null, error: null }); } }, clear, dispose });
}
export type SourceContentOwner = ReturnType<typeof createSourceContentOwner>;
