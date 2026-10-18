import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { APPROVED_BOOKLET as approved, projectBooklet } from "../../src/server/honoree/booklet-projector";
import type { ServiceFeed, ServiceUnit } from "../../src/server/service-learning/feed";
import { unitPair } from "../../src/server/honoree/recipient-material";

type Mutable<T> = { -readonly [K in keyof T]: Mutable<T[K]> };
function unit(slot: "morning" | "havdalah", after: boolean): Mutable<ServiceUnit> {
  let n = 0;
  return { id: unitPair(slot)[after ? 1 : 0], family: slot === "morning" ? "bm-shacharit" : "bm-maariv", name: "Invented example", section: 0, caption: "",
    blocks: (after ? [5, 2] : [1, 1, 5]).flatMap((length, group) => [
      ...Array.from({ length }, () => ({ type: "stanza", he: ` ${slot}:${after}:${n++}:א\u05b7\nב `, bare: "excluded" })),
      { type: "english", en: ` ${slot}:${after}:${group}: <strong>invented</strong>\n ` },
    ]) };
}
function feed(): Mutable<ServiceFeed> {
  return { identity: approved.identity, schemaVersion: 1, volume: "legacy-beit-mitzvah", title: "Invented",
    source: { gitSha: approved.sourceGitSha, lane: "licensed", pages: 1, builtAt: "2026-01-01T00:00:00Z" },
    artifact: { repo: approved.artifactRepo, commit: approved.artifactCommit, runId: approved.artifactRunId, builtAt: "2026-01-01T00:00:00Z" },
    license: { attribution: " Invented credit\n ", spdx: "LicenseRef-Invented" }, sections: [], front: [], pageIndex: {},
    units: [unit("morning", false), unit("morning", true), unit("havdalah", false), unit("havdalah", true)] };
}
test.each(["morning", "havdalah"] as const)("%s projection consumes all 19 blocks with exact whitespace, Unicode, line boundaries and ordered credits", slot => {
  const source = feed(), result = projectBooklet(source, slot), selected = source.units.filter(u => u.family === (slot === "morning" ? "bm-shacharit" : "bm-maariv"));
  expect(result.version).toBe(approved.version); expect(result.credits).toEqual([source.license.attribution, source.license.spdx]);
  expect(result.before).toHaveLength(3); expect(result.after).toHaveLength(2);
  for (const [index, output] of [result.before, result.after].entries()) {
    let cursor = 0;
    for (const block of output) {
      const pending: string[] = [];
      while (selected[index].blocks[cursor].type === "stanza") pending.push(selected[index].blocks[cursor++].he!);
      expect(block).toEqual({ he: pending.join("\n"), en: selected[index].blocks[cursor++].en });
    }
    expect(cursor).toBe(selected[index].blocks.length);
  }
  expect(Object.keys(result)).toEqual(["version", "before", "after", "credits"]);
  expect(JSON.stringify(result)).not.toContain("excluded");
  expect(JSON.stringify(result)).not.toContain(slot === "morning" ? "havdalah" : "morning");
});
test("closed source identity, exact family pair, slots and mandatory credits", () => {
  const changes: ((f: ReturnType<typeof feed>) => void)[] = [
    f => { f.identity = "0".repeat(64); }, f => { f.source.gitSha = "other"; }, f => { f.artifact.commit = "other"; },
    f => { f.license.attribution = ""; }, f => { f.license.spdx = ""; }, f => { f.units = f.units.slice(1); },
    f => { f.units = [...f.units, f.units[0]]; }, f => { f.units[0].family = "bm-maariv"; },
  ];
  // Mutations deliberately exercise hostile runtime objects beyond readonly input types.
  for (const change of changes) { const source = feed(); change(source); expect(() => projectBooklet(source, "morning")).toThrow(); }
  for (const slot of ["unknown", "", null]) expect(() => projectBooklet(feed(), slot as "morning")).toThrow();
});
test("rejects every unsupported structure or incomplete run instead of losing content", () => {
  const edits = [
    { caption: "Invented caption" }, { renderSegments: { he: [], en: [] } }, { sourceBoundaries: { en: [] } }, { renderStructure: { kind: "paragraphs" } },
  ];
  for (const edit of edits) { const source = feed(); Object.assign(source.units[0], edit); expect(() => projectBooklet(source, "morning")).toThrow(); }
  for (const edit of [{ type: "rubric" }, { footnote: [{ t: "Invented note" }] }, { cue: "Invented cue" }, { tr: "excluded" }, { he: "\ud800" }, { he: "" }, { text: [] }, { marks: [] }, { role: "original" }, { en: "extra" }]) {
    const source = feed(); Object.assign(source.units[0].blocks[0], edit); expect(() => projectBooklet(source, "morning")).toThrow();
  }
  for (const edit of [{ en: [{ t: "Invented rich text" }] }, { en: "\ud800" }, { en: "" }, { he: "extra" }]) {
    const source = feed(); Object.assign(source.units[0].blocks[1], edit); expect(() => projectBooklet(source, "morning")).toThrow();
  }
  for (const mutate of [(b: unknown[]) => b.shift(), (b: unknown[]) => b.pop(), (b: unknown[]) => b.push({ type: "stanza", he: "Invented trailing" }), (b: unknown[]) => b.splice(1, 0, { type: "stanza", he: "Invented extra" })]) {
    const source = feed(); mutate(source.units[0].blocks as unknown[]); expect(() => projectBooklet(source, "morning")).toThrow();
  }
  const source = feed(); Object.assign(source.units[0].blocks[0], { he: "x".repeat(8193) }); expect(() => projectBooklet(source, "morning")).toThrow();
});
