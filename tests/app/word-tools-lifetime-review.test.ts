import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createWordToolsSelection } from "../../src/components/portal/workspace/study/word-tools-selection";
import { PortalRequestError } from "../../src/components/portal/api";
import { normalizeHebrew } from "../../src/server/study/normalize";
import type { StudyVerse } from "../../src/components/portal/workspace/study/api";
import type { StudyWordAids } from "../../src/lib/hebrew/word-aids";
import type { StudyWordDetails } from "../../src/lib/hebrew/word-details";

const verses: StudyVerse[] = ["דָּג־בָּג", "זָח"].map((text, i) => { const h = normalizeHebrew(text); return { ref: `Genesis 1:${i + 1}`, english: null, hebrew: { ...h, segments: h.segments.map(s => ({ ...s })) } }; });
const aids = (i = 0): StudyWordAids => Object.freeze({ schema: "study-word-aids/v1", ref: verses[i].ref, status: "unavailable", reason: "analysis-unavailable" });
const details = (verse = 0, index = 0): StudyWordDetails => Object.freeze({ schema: "study-word-details/v1", ref: verses[verse].ref, wordIndex: index, status: "unavailable", reason: "reconstruction" });
function deferred<T>() { let resolve!: (value: T) => void, reject!: (value: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function flush() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }

it("review closed construction and explicit remembered selection do no I/O until open; study navigation has no audio capability", async () => {
  const readAids = vi.fn(async (v: number) => aids(v)), readDetails = vi.fn(async (v: number, w: number) => details(v, w)), onState = vi.fn();
  const owner = createWordToolsSelection({ verses, readAids, readDetails, onState }); owner.select(0, 1); owner.select(9, 0); expect(readAids).not.toHaveBeenCalled(); expect(owner.state.open).toBe(false);
  owner.open(); await flush(); expect(readAids.mock.calls[0][0]).toBe(0); expect(readDetails.mock.calls[0].slice(0, 2)).toEqual([0, 1]);
  expect(owner.state.selection).toEqual({ verse: 0, index: 1 }); owner.navigate(1); await flush(); expect(owner.state.selection).toEqual({ verse: 1, index: 0 }); owner.navigate(-1); await flush(); expect(owner.state.selection).toEqual({ verse: 0, index: 1 });
  expect(Object.keys(owner)).not.toContain("play"); owner.dispose();
});

it("review newer explicit selection aborts both old fields and late old replies cannot replace either selected result", async () => {
  const oldAids = deferred<StudyWordAids>(), oldDetails = deferred<StudyWordDetails>(), started = deferred<void>(), signals: AbortSignal[] = [];
  const owner = createWordToolsSelection({ verses, readAids: async (v, signal) => { signals.push(signal); if (v === 0) { started.resolve(); return oldAids.promise; } return aids(v); },
    readDetails: async (v, i) => v === 0 ? oldDetails.promise : details(v, i), onState() {} });
  owner.open(); await started.promise; owner.select(1, 0); await flush(); expect(signals[0].aborted).toBe(true); expect(owner.state.selection).toEqual({ verse: 1, index: 0 });
  oldAids.resolve(aids(0)); oldDetails.resolve(details(0, 0)); await flush(); expect(owner.state.aids).toMatchObject({ status: "ready", value: { ref: "Genesis 1:2" } }); expect(owner.state.details).toMatchObject({ status: "ready", value: { ref: "Genesis 1:2", wordIndex: 0 } }); owner.dispose();
});

it("review nonauthority source failure retains only the useful independent field and explicit retry starts fresh reads", async () => {
  const readAids = vi.fn(async () => aids()), readDetails = vi.fn<() => Promise<StudyWordDetails>>().mockRejectedValueOnce(new PortalRequestError(503)).mockResolvedValue(details());
  const owner = createWordToolsSelection({ verses, readAids, readDetails, onState() {} }); owner.open(); await flush();
  expect(owner.state.open).toBe(true); expect(owner.state.aids).toMatchObject({ status: "ready" }); expect(owner.state.details).toEqual({ status: "error" });
  owner.retry(); await flush(); expect(readAids).toHaveBeenCalledTimes(2); expect(readDetails).toHaveBeenCalledTimes(2); expect(owner.state.details).toMatchObject({ status: "ready" }); owner.dispose();
});

it.each([401, 403, 404, 409])("review actual refusal%s clears both private fields and cannot be revived by a late other-field success", async status => {
  const held = deferred<StudyWordAids>(), failure = deferred<StudyWordDetails>(), entered = deferred<void>();
  const owner = createWordToolsSelection({ verses, readAids: () => held.promise, readDetails: () => { entered.resolve(); return failure.promise; }, onState() {} });
  owner.open(); await entered.promise; failure.reject(new PortalRequestError(status)); await flush(); expect(owner.state).toMatchObject({ open: false, selection: null, aids: { status: "idle" }, details: { status: "idle" } });
  held.resolve(aids()); await flush(); expect(owner.state.open).toBe(false); expect(owner.state.aids).toEqual({ status: "idle" }); owner.dispose();
});

it("review close/dispose cancels and drops results; late completion cannot publish or fetch after disposal", async () => {
  const a = deferred<StudyWordAids>(), d = deferred<StudyWordDetails>(), entered = deferred<void>(), onState = vi.fn(), signals: AbortSignal[] = [];
  const readAids = vi.fn((_v: number, signal: AbortSignal) => { signals.push(signal); entered.resolve(); return a.promise; }), readDetails = vi.fn(() => d.promise);
  const owner = createWordToolsSelection({ verses, readAids, readDetails, onState }); owner.open(); await entered.promise; owner.close(); expect(signals[0].aborted).toBe(true); owner.dispose(); const count = onState.mock.calls.length;
  a.resolve(aids()); d.resolve(details()); await flush(); owner.open(); owner.select(1, 0); owner.retry(); expect(onState).toHaveBeenCalledTimes(count); expect(readAids).toHaveBeenCalledTimes(1); expect(readDetails).toHaveBeenCalledTimes(1);
});
