import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { APPROVED_BOOKLET as approved, projectBooklet } from "../../src/server/honoree/booklet-projector";
import type { ServiceFeed, ServiceUnit } from "../../src/server/service-learning/feed";
import { unitPair } from "../../src/server/honoree/recipient-material";

function source(): ServiceFeed {
  const units: ServiceUnit[] = [false, true].map(after => ({
    id: unitPair("morning")[after ? 1 : 0], family: "bm-shacharit", name: "Synthetic peer unit", section: 0,
    blocks: (after ? [5, 2] : [1, 1, 5]).flatMap(count => [
      ...Array.from({ length: count }, () => ({ type: "stanza", he: "א" })),
      { type: "english", en: "Synthetic peer translation" },
    ]),
  }));
  return { identity: approved.identity, schemaVersion: 1, volume: "legacy-beit-mitzvah", title: "Synthetic peer source",
    source: { gitSha: approved.sourceGitSha, lane: "licensed", pages: 1, builtAt: "2026-01-01T00:00:00Z" },
    artifact: { repo: approved.artifactRepo, commit: approved.artifactCommit, runId: approved.artifactRunId, builtAt: "2026-01-01T00:00:00Z" },
    license: { attribution: "Synthetic peer notice", spdx: "LicenseRef-Peer" }, sections: [], front: [], pageIndex: {}, units };
}

test("peer: joining valid-size stanzas cannot bypass output bounds or repair malformed source strings; notices retain text validation", () => {
  expect(projectBooklet(source(), "morning").after).toHaveLength(2);
  for (const alteration of ["aggregate-size", "split-surrogates", "notice-control", "notice-surrogate"]) {
    const feed = source();
    // Deliberate hostile runtime edits beyond immutable source types.
    if (alteration === "aggregate-size") {
      for (let index = 0; index < 5; index++) Object.assign(feed.units[1].blocks[index], { he: "א".repeat(1700) });
    } else if (alteration === "split-surrogates") {
      Object.assign(feed.units[1].blocks[0], { he: "\ud83d" });
      Object.assign(feed.units[1].blocks[1], { he: "\ude00" });
    } else {
      Object.assign(feed.license, { attribution: alteration === "notice-control" ? "Synthetic\u0000notice" : "Synthetic\ud800notice" });
    }
    expect(() => projectBooklet(feed, "morning"), alteration).toThrow();
  }
});
