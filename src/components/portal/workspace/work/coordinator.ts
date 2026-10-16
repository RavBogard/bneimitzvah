import { PortalRequestError } from "../../api";
import type { Assigned } from "../api";
import type { StudyKind } from "../study/api";
import { normalizeWork, workScope, workTextError, WorkError, type Stream, type WorkHistory, type WorkOperation, type WorkPage, type WorkReceipt, type WorkVersion, type WorkVerse } from "./api";

type Phase = "ready" | "saving" | "unknown" | "conflict" | "invalid" | "unavailable";
export type PendingWrite = Readonly<{ type: Stream; verseRef: string; text: string; expectedVersion: number; mutationId: string }>;
export type WorkCell = { text: string; head: WorkVersion | null; verified: boolean; phase: Phase; error: string; composing: boolean;
  pending?: PendingWrite; task?: Promise<void>; recovery?: Promise<void>; timer?: ReturnType<typeof setTimeout>; committedEarlier?: number; history?: WorkHistory; historyBefore?: number; historyBusy?: boolean };
type Scope = { baseline: Assigned; kind: StudyKind; key: string; cells: Map<string, WorkCell>; verses: Map<string, WorkVerse>; pages: Map<number, string[]>; offset: number; nextOffset: number | null; loading: boolean; error: boolean; readSequence: number };
export type WorkTransport = (baseline: Assigned, kind: StudyKind, operation: WorkOperation, signal: AbortSignal) => Promise<WorkPage | WorkReceipt | WorkHistory>;
const cellKey = (ref: string, stream: Stream) => `${stream}:${ref}`;
const fresh = (head: WorkVersion | null, stream: Stream): WorkCell => ({ text: stream === "draft" ? head?.text ?? "" : "", head, verified: true, phase: "ready", error: "", composing: false });
const status = (error: unknown) => error instanceof PortalRequestError ? error.status : 503;
const authority = (error: unknown) => [401, 403, 404].includes(status(error));

/** Mounted memory only. Each UUID owns one frozen body until a definite outcome. */
export class WorkCoordinator {
  private scopes = new Map<StudyKind, Scope>();
  private listeners = new Set<() => void>();
  private revision = 0;
  private generation = 0;
  private pauseEpoch = 0;
  private reads = new Set<AbortController>();
  private paused = true;
  private acceptedEpoch: number | null = null;
  private alive = true;
  active: { kind: StudyKind; ref: string } | null = null;
  departure: { resolve(value: boolean): void; busy: boolean; error: string } | null = null;
  notice = "";
  constructor(private transport: WorkTransport, private verify: (signal: AbortSignal) => Promise<Assigned>, private denied: (status: number) => void) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.revision;
  get lifecycle() { return this.pauseEpoch; }
  private emit() { this.revision++; this.listeners.forEach(listener => listener()); }
  scope(kind: StudyKind) { return this.scopes.get(kind); }
  cell(kind: StudyKind, ref: string, stream: Stream) { return this.scopes.get(kind)?.cells.get(cellKey(ref, stream)); }
  private current(scope: Scope, generation: number) { return this.alive && this.generation === generation && this.scopes.get(scope.kind) === scope; }
  private cancelTimers() { this.scopes.forEach(scope => scope.cells.forEach(cell => { clearTimeout(cell.timer); cell.timer = undefined; })); }
  pause = () => { this.pauseEpoch++; this.acceptedEpoch = null; this.paused = true; this.cancelTimers(); this.scopes.forEach(scope => scope.cells.forEach(cell => { cell.verified = false; cell.history = undefined; })); this.reads.forEach(request => request.abort()); this.reads.clear(); this.emit(); };
  clear = (notice = "") => { this.generation++; this.pause(); this.scopes.clear(); this.active = null; this.notice = notice; this.departure?.resolve(false); this.departure = null; this.emit(); };
  dispose = () => { this.clear(); this.alive = false; };
  configure(baseline: Assigned) {
    const changed = [...this.scopes.values()].some(scope => !baseline.readings.some(row => row.kind === scope.kind) || scope.key !== workScope(baseline, scope.kind));
    if (changed) this.clear("The assignment changed. Previous unsent edits were cleared; an unconfirmed request may have saved under the earlier assignment.");
    for (const row of baseline.readings) {
      const scope = this.scopes.get(row.kind);
      if (scope) scope.baseline = baseline;
      else this.scopes.set(row.kind, { baseline, kind: row.kind, key: workScope(baseline, row.kind), cells: new Map(), verses: new Map(), pages: new Map(), offset: 0, nextOffset: null, loading: false, error: false, readSequence: 0 });
    }
    this.emit();
  }
  async settle() { await Promise.all([...this.scopes.values()].flatMap(scope => [...scope.cells.values()].flatMap(cell => [cell.task, cell.recovery]).filter((task): task is Promise<void> => Boolean(task)))); }
  async reload(signal: AbortSignal, kind: StudyKind) {
    const scope = this.scopes.get(kind), lifecycle = this.pauseEpoch; if (!scope) return;
    // Reconcile every staged/unresolved stream before revealing the workspace.
    for (const candidate of this.scopes.values()) {
      const refs = new Set([...candidate.cells.entries()].filter(([key, cell]) => cell.pending || (key.startsWith("draft:") ? cell.text !== (cell.head?.text ?? "") : Boolean(cell.text))).map(([key]) => key.slice(key.indexOf(":") + 1)));
      for (const ref of refs) {
        if (signal.aborted || lifecycle !== this.pauseEpoch) return;
        const ordinal = candidate.baseline.readings.find(row => row.kind === candidate.kind)!.verses.indexOf(ref);
        await this.loadPage(candidate.kind, ordinal, signal);
        if (signal.aborted || lifecycle !== this.pauseEpoch) return;
        for (const stream of ["draft", "note"] as const) if (this.cell(candidate.kind, ref, stream)?.pending) await this.recover(candidate.kind, ref, stream, false, signal, false);
      }
    }
    if (signal.aborted || lifecycle !== this.pauseEpoch) return;
    await this.loadPage(kind, scope.offset, signal);
    if (signal.aborted || lifecycle !== this.pauseEpoch) return;
    // The reading and provider barriers must both accept before writes resume.
  }
  accept(lifecycle: number) { if (lifecycle === this.pauseEpoch) this.acceptedEpoch = lifecycle; }
  reveal = () => {
    if (this.acceptedEpoch !== this.pauseEpoch) return;
    this.paused = false; this.scopes.forEach(candidate => candidate.cells.forEach((cell, key) => { if (cell.phase === "ready" && key.startsWith("draft:") && cell.verified) this.schedule(candidate.kind, key.slice(6), cell); })); this.emit();
  };
  hasUnsaved = () => [...this.scopes.values()].some(scope => [...scope.cells.entries()].some(([key, cell]) => cell.pending || (key.startsWith("note:") ? Boolean(cell.text) : cell.text !== (cell.head?.text ?? ""))));
  private relevant(scope: Scope, ref: string) { return ["draft", "note"].some(stream => { const cell = scope.cells.get(cellKey(ref, stream as Stream)); return cell && (cell.pending || (stream === "note" ? Boolean(cell.text) : cell.text !== (cell.head?.text ?? ""))); }); }
  async loadPage(kind: StudyKind, offset: number, outer?: AbortSignal) {
    const scope = this.scopes.get(kind); if (!scope) return false;
    const generation = this.generation, turn = ++scope.readSequence, request = new AbortController(), abort = () => request.abort(); if (outer?.aborted) abort(); outer?.addEventListener("abort", abort, { once: true }); this.reads.add(request);
    scope.loading = true; scope.error = false; this.emit();
    try {
      const page = await this.transport(scope.baseline, kind, { type: "page", offset }, request.signal) as WorkPage;
      if (!this.current(scope, generation) || request.signal.aborted || turn !== scope.readSequence) return false;
      // A pre-commit read is never allowed to replace an acknowledged newer head.
      for (const verse of page.verses) for (const stream of ["draft", "note"] as const) {
        const known = scope.cells.get(cellKey(verse.ref, stream))?.head, incoming = stream === "draft" ? verse.draft : verse.notes[0] ?? null;
        if (known && (!incoming || incoming.version < known.version || incoming.version === known.version && (incoming.id !== known.id || incoming.text !== known.text))) return false;
      }
      // Three pages plus staged verses, never an unbounded full-assignment prefetch.
      scope.pages.delete(offset); scope.pages.set(offset, page.verses.map(row => row.ref));
      while (scope.pages.size > 3) { const [oldOffset, refs] = scope.pages.entries().next().value!; scope.pages.delete(oldOffset);
        for (const ref of refs) if (!this.relevant(scope, ref) && ![...scope.pages.values()].some(rows => rows.includes(ref))) { scope.verses.delete(ref); scope.cells.delete(cellKey(ref, "draft")); scope.cells.delete(cellKey(ref, "note")); }
      }
      for (const verse of page.verses) {
        scope.verses.set(verse.ref, verse);
        for (const stream of ["draft", "note"] as const) {
          const key = cellKey(verse.ref, stream), head = stream === "draft" ? verse.draft : verse.notes[0] ?? null, cell = scope.cells.get(key);
          if (!cell) scope.cells.set(key, fresh(head, stream));
          else {
            const changed = (cell.head?.version ?? 0) !== (head?.version ?? 0), staged = stream === "draft" ? cell.text !== (cell.head?.text ?? "") : Boolean(cell.text);
            if (!cell.pending && changed && staged) { cell.phase = "conflict"; cell.error = "Another version was saved. Review before saving yours."; }
            else if (!cell.pending && !staged && cell.phase !== "conflict") { if (stream === "draft") cell.text = head?.text ?? ""; cell.phase = "ready"; }
            cell.head = head; cell.verified = true;
            if (cell.phase === "unavailable") cell.phase = "ready";
          }
        }
      }
      scope.offset = offset; scope.nextOffset = page.nextOffset;
      return true;
    } catch (error) {
      if (!this.current(scope, generation) || request.signal.aborted || turn !== scope.readSequence) return false;
      scope.error = true; scope.cells.forEach(cell => { cell.verified = false; cell.history = undefined; });
      if (authority(error) || error instanceof WorkError && error.code === "stale-revision") { this.clear("Work access or assignment changed. Unsent edits were cleared; an unconfirmed request may have saved."); this.denied(status(error)); throw error; }
      return false;
    } finally { this.reads.delete(request); outer?.removeEventListener("abort", abort); if (this.current(scope, generation) && turn === scope.readSequence) { scope.loading = false; this.emit(); } }
  }
  async open(kind: StudyKind, ref: string) {
    const scope = this.scopes.get(kind); if (!scope) return;
    if (!scope.verses.has(ref)) {
      if (scope.pages.size >= 3 && [...scope.pages.values()].every(refs => refs.some(ref => this.relevant(scope, ref))) && !await this.guard()) return;
    }
    if (this.scopes.get(kind) !== scope) return;
    this.active = { kind, ref }; this.emit();
    if (!scope.verses.has(ref) || !this.cell(kind, ref, "draft")?.verified) { const ordinal = scope.baseline.readings.find(row => row.kind === kind)!.verses.indexOf(ref); await this.loadPage(kind, ordinal); }
  }
  close(kind: StudyKind, ref: string) { if (this.active?.kind === kind && this.active.ref === ref) { this.active = null; this.emit(); } }
  edit(kind: StudyKind, ref: string, stream: Stream, text: string) {
    const cell = this.cell(kind, ref, stream); if (!cell) return;
    cell.text = normalizeWork(text); cell.error = workTextError(cell.text, stream) ?? "";
    if (cell.phase === "invalid" && !cell.error) cell.phase = "ready";
    if (stream === "draft") this.schedule(kind, ref, cell); this.emit();
  }
  composition(kind: StudyKind, ref: string, stream: Stream, composing: boolean) {
    const cell = this.cell(kind, ref, stream); if (!cell) return; cell.composing = composing;
    clearTimeout(cell.timer); cell.timer = undefined; if (!composing && stream === "draft") this.schedule(kind, ref, cell); this.emit();
  }
  private schedule(kind: StudyKind, ref: string, cell: WorkCell) {
    clearTimeout(cell.timer); cell.timer = undefined;
    if (this.paused || this.departure || !cell.verified || cell.pending || cell.composing || cell.phase !== "ready" || cell.text === (cell.head?.text ?? "") || workTextError(cell.text, "draft")) return;
    cell.timer = setTimeout(() => { cell.timer = undefined; void this.save(kind, ref, "draft"); }, 800);
  }
  async save(kind: StudyKind, ref: string, stream: Stream, departureSave = false) {
    const scope = this.scopes.get(kind), cell = this.cell(kind, ref, stream); if (!scope || !cell || this.paused || this.departure && !departureSave || !cell.verified || cell.composing || cell.pending || ["conflict", "unknown", "unavailable"].includes(cell.phase)) return;
    clearTimeout(cell.timer); cell.timer = undefined;
    if (stream === "draft" && cell.text === (cell.head?.text ?? "")) return;
    const error = workTextError(cell.text, stream); if (error) { cell.error = error; cell.phase = "invalid"; this.emit(); return; }
    if ((cell.head?.version ?? 0) >= 2147483647) { cell.error = "This verse cannot accept another version. Ask your rabbi for help."; cell.phase = "invalid"; this.emit(); return; }
    cell.pending = Object.freeze({ type: stream, verseRef: ref, text: cell.text, expectedVersion: cell.head?.version ?? 0, mutationId: crypto.randomUUID() });
    await this.dispatch(scope, cell);
  }
  private async dispatch(scope: Scope, cell: WorkCell) {
    const pending = cell.pending!; if (cell.task) return cell.task;
    const generation = this.generation; cell.phase = "saving"; cell.error = ""; this.emit();
    const task = (async () => {
      try {
        const receipt = await this.transport(scope.baseline, scope.kind, pending, new AbortController().signal) as WorkReceipt;
        if (!this.current(scope, generation)) return;
        this.acknowledge(scope, cell, pending, receipt);
        if (receipt.currentLatestVersion > receipt.committedVersion) await this.loadPage(scope.kind, scope.baseline.readings.find(row => row.kind === scope.kind)!.verses.indexOf(pending.verseRef));
      } catch (error) {
        if (!this.current(scope, generation)) return;
        if (authority(error) || error instanceof WorkError && error.code === "stale-revision") { this.clear("Work access or assignment changed. Unsent edits were cleared; an unconfirmed request may have saved."); this.denied(status(error)); return; }
        if (error instanceof WorkError && error.code === "conflict") { cell.pending = undefined; cell.phase = "conflict"; cell.error = "Another version was saved. Review before saving yours.";
          await this.loadPage(scope.kind, scope.baseline.readings.find(row => row.kind === scope.kind)!.verses.indexOf(pending.verseRef)); }
        else if (error instanceof WorkError && error.code === "invalid-request") { cell.pending = undefined; cell.phase = "invalid"; cell.error = "Not saved. Check this text before saving again."; }
        else { cell.phase = "unknown"; cell.error = "Save not confirmed. Your text is still in this tab."; }
      } finally { if (this.current(scope, generation)) { cell.task = undefined; this.emit(); if (pending.type === "draft" && cell.phase === "ready") this.schedule(scope.kind, pending.verseRef, cell); } }
    })(); cell.task = task; await task;
  }
  private acknowledge(scope: Scope, cell: WorkCell, pending: PendingWrite, receipt: WorkReceipt) {
    const assignment = scope.baseline.readings.find(row => row.kind === scope.kind)!;
    if (receipt.committed.text !== pending.text || receipt.committedVersion !== pending.expectedVersion + 1 || receipt.committed.version !== receipt.committedVersion || receipt.committed.verseRef !== pending.verseRef || receipt.committed.assignmentId !== assignment.id || receipt.committed.assignmentRevision !== assignment.revision || receipt.currentLatestVersion < receipt.committedVersion
      || cell.head?.version === receipt.committedVersion && (cell.head.id !== receipt.committed.id || cell.head.text !== receipt.committed.text)) {
      cell.phase = "unknown"; cell.verified = false; cell.error = "Save not confirmed. The response did not match this save. Check save again."; return;
    }
    const observedNewer = (cell.head?.version ?? 0) > receipt.committedVersion;
    cell.pending = undefined; if (!observedNewer) cell.head = receipt.committed; cell.verified = !this.paused;
    if (pending.type === "note" && cell.text === pending.text) cell.text = "";
    cell.phase = observedNewer || receipt.currentLatestVersion > receipt.committedVersion ? "conflict" : "ready";
    cell.committedEarlier = cell.phase === "conflict" ? receipt.committedVersion : undefined;
    cell.error = cell.phase === "conflict" ? "An earlier save succeeded. A newer version is saved. Review before saving yours." : "";
    const verse = scope.verses.get(pending.verseRef); if (verse && !observedNewer) { if (pending.type === "draft") verse.draft = receipt.committed; else verse.notes = [receipt.committed, ...verse.notes.filter(row => row.id !== receipt.committed.id)].slice(0, 3); }
  }
  async recover(kind: StudyKind, ref: string, stream: Stream, retry = false, outer?: AbortSignal, verify = true) {
    const cell = this.cell(kind, ref, stream); if (!cell) return;
    if (cell.recovery) return cell.recovery;
    const task = this.recoverOnce(kind, ref, stream, retry, outer, verify); cell.recovery = task;
    try { await task; } finally { if (cell.recovery === task) { cell.recovery = undefined; this.emit(); } }
  }
  private async recoverOnce(kind: StudyKind, ref: string, stream: Stream, retry = false, outer?: AbortSignal, verify = true) {
    const scope = this.scopes.get(kind), cell = this.cell(kind, ref, stream), pending = cell?.pending; if (!scope || !cell || !pending || cell.task) return;
    const generation = this.generation, request = new AbortController(), abort = () => request.abort(); if (outer?.aborted) abort(); outer?.addEventListener("abort", abort, { once: true }); this.reads.add(request);
    let absent = false;
    try {
      if (verify) { const next = await this.verify(request.signal); if (!this.current(scope, generation) || request.signal.aborted) return;
        if (!next.readings.some(row => row.kind === kind) || workScope(next, kind) !== scope.key) { this.configure(next); this.denied(409); return; } scope.baseline = next; }
      let receipt: WorkReceipt | null = null;
      try { receipt = await this.transport(scope.baseline, kind, { type: "receipt", stream, verseRef: ref, mutationId: pending.mutationId }, request.signal) as WorkReceipt; }
      catch (error) { if (status(error) !== 404) throw error; absent = true; }
      if (!this.current(scope, generation) || request.signal.aborted) return;
      const assignment = scope.baseline.readings.find(row => row.kind === kind)!;
      if (receipt && (receipt.committed.text !== pending.text || receipt.committedVersion !== pending.expectedVersion + 1 || receipt.committed.version !== receipt.committedVersion || receipt.committed.verseRef !== pending.verseRef || receipt.committed.assignmentId !== assignment.id || receipt.committed.assignmentRevision !== assignment.revision)) throw new WorkError(503);
      // A missing receipt is only meaningful after a successful current-authority head read.
      const verified = await this.loadPage(kind, scope.baseline.readings.find(row => row.kind === kind)!.verses.indexOf(ref), request.signal);
      if (!this.current(scope, generation) || request.signal.aborted || !verified || !cell.verified) return;
      if (receipt) {
        const head = cell.head;
        if (head && head.version >= receipt.committedVersion && (head.version !== receipt.committedVersion || head.text === receipt.committed.text)) {
          cell.pending = undefined; if (stream === "note" && cell.text === pending.text) cell.text = "";
          cell.phase = head.version === receipt.committedVersion ? "ready" : "conflict"; cell.committedEarlier = head.version > receipt.committedVersion ? receipt.committedVersion : undefined;
          cell.error = cell.phase === "conflict" ? "An earlier save succeeded. A newer version is saved. Review before saving yours." : "";
          if (!this.paused && stream === "draft" && cell.phase === "ready") this.schedule(kind, ref, cell);
        } else { cell.phase = "unknown"; cell.error = "The save receipt and current work could not be reconciled. Check save again."; }
      } else if (absent && retry && !this.paused) await this.dispatch(scope, cell);
      else { cell.phase = "unknown"; cell.error = "Save not confirmed. No receipt was found; the request may still have saved. You can retry the same save under this assignment."; }
    } catch (error) {
      if (!this.current(scope, generation) || request.signal.aborted) return;
      if (authority(error) || error instanceof WorkError && error.code === "stale-revision") { this.clear("Work access changed. Unsent edits were cleared; an unconfirmed request may have saved."); this.denied(status(error)); }
      else { cell.phase = "unknown"; cell.verified = false; cell.error = "Save not confirmed. Check save again when work is available."; }
    } finally { this.reads.delete(request); outer?.removeEventListener("abort", abort); if (this.current(scope, generation)) this.emit(); }
  }
  resolveConflict(kind: StudyKind, ref: string, stream: Stream, useSaved: boolean) {
    const cell = this.cell(kind, ref, stream); if (!cell?.verified || cell.pending || this.paused) return;
    if (useSaved) cell.text = stream === "draft" ? cell.head?.text ?? "" : "";
    cell.phase = "ready"; cell.error = ""; cell.committedEarlier = undefined;
    // Explicit review does not submit a note; learner Save now also remains deliberate here.
    this.emit();
  }
  async history(kind: StudyKind, ref: string, stream: Stream, before?: number) {
    const scope = this.scopes.get(kind), cell = this.cell(kind, ref, stream); if (!scope || !cell?.verified || this.paused || cell.historyBusy) return;
    const generation = this.generation, request = new AbortController(); this.reads.add(request); cell.historyBusy = true; cell.error = ""; this.emit();
    try { const history = await this.transport(scope.baseline, kind, { type: "history", stream, verseRef: ref, ...(before === undefined ? {} : { beforeVersion: before }) }, request.signal) as WorkHistory;
      if (this.current(scope, generation) && !request.signal.aborted) { cell.history = history; cell.historyBefore = before; }
    } catch (error) { if (this.current(scope, generation) && !request.signal.aborted) { if (authority(error) || error instanceof WorkError && error.code === "stale-revision") { this.clear(); this.denied(status(error)); } else cell.error = "History unavailable. Try loading history again."; } }
    finally { this.reads.delete(request); if (this.current(scope, generation)) { cell.historyBusy = false; this.emit(); } }
  }
  guard = async (): Promise<boolean> => {
    if (!this.hasUnsaved()) return true;
    if (this.departure) return false;
    this.cancelTimers(); return new Promise<boolean>(resolve => {
      const waiting = [...this.scopes.values()].some(scope => [...scope.cells.values()].some(cell => cell.task));
      const departure = { resolve, busy: waiting, error: "" }; this.departure = departure; this.emit();
      if (waiting) void this.settle().then(() => { if (this.departure === departure) { departure.busy = false; this.emit(); } });
    });
  };
  async depart(action: "cancel" | "discard" | "save" | "check") {
    const departure = this.departure; if (!departure || departure.busy) return;
    if (action === "cancel") { this.departure = null; departure.resolve(false); this.emit(); return; }
    if (action === "discard") {
      this.generation++; this.cancelTimers(); this.reads.forEach(request => request.abort()); this.reads.clear();
      this.scopes.forEach(scope => scope.cells.forEach((cell, key) => { cell.pending = undefined; cell.task = undefined; cell.text = key.startsWith("draft:") ? cell.head?.text ?? "" : ""; cell.phase = "ready"; cell.error = ""; cell.verified = false; cell.history = undefined; }));
      this.departure = null; departure.resolve(true); this.emit(); return;
    }
    departure.busy = true; this.emit(); await this.settle();
    if (this.departure !== departure) return;
    for (const scope of this.scopes.values()) for (const [key, cell] of scope.cells) {
      const stream = key.startsWith("draft:") ? "draft" : "note", ref = key.slice(key.indexOf(":") + 1);
      if (cell.pending) await this.recover(scope.kind, ref, stream);
      else if (action === "save" && (stream === "draft" ? cell.text !== (cell.head?.text ?? "") : Boolean(cell.text))) await this.save(scope.kind, ref, stream, true);
    }
    if (this.departure !== departure) return;
    if (!this.hasUnsaved()) { this.departure = null; departure.resolve(true); }
    else { departure.busy = false; departure.error = "There is still unsaved or unconfirmed work. Review it before continuing."; }
    this.emit();
  }
}
