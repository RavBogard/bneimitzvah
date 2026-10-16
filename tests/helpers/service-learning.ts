import { createHash } from "node:crypto";
import { parseServiceFeed, type ServiceFeedPins } from "../../src/server/service-learning/feed";
export function syntheticServiceCatalog(seed = "one") {
  const family = "bm-shacharit", first = `sample.first@${family}`, hidden = `sample.hidden@${family}`, second = `sample.second@${family}`, evening = "sample.evening@bm-maariv";
  const units = [first, hidden, second, evening].map((id, index) => ({ id, name: `Synthetic part ${index}`, section: index === 3 ? 1 : 0,
    caption: `Synthetic caption ${index}`, group: null, folios: [index + 1], printedFolio: index + 1,
    ...(id === hidden ? { companionOf: first, companionRole: "preparation" } : {}),
    blocks: [{ type: "stanza", he: "א֑ב\u200f", bare: "אב", tr: "omitted-synthetic", en: [{ t: `Synthetic translation ${index}` }, { footnote: [{ t: "Synthetic credit" }] }], folio: index + 1, phys: index + 1 },
      { type: "english", role: "original", en: `Synthetic original ${index}.`, footnote: [{ em: [{ t: "Synthetic note" }] }], folio: index + 1, phys: index + 1 }] }));
  const feed = { schemaVersion: 1, volume: "legacy-beit-mitzvah", title: `Synthetic service ${seed}`, blockGranularity: "line",
    printing: { gitSha: "abcdef1-LICENSED", pages: 8, builtAt: "2026-10-15T00:00:00Z", source: { gitSha: "abcdef1-LICENSED", pages: 8, builtAt: "2026-10-15T00:00:00Z", lane: "licensed" } },
    license: { spdx: "LicenseRef-Synthetic", attribution: "Synthetic CRC-only credit" }, sections: [{ idx: 0, en: "Synthetic morning", opener: true }, { idx: 1, en: "Synthetic evening", opener: false }], units,
    front: [{ type: "rubric", text: [{ t: "Unselected synthetic front" }] }],
    pageIndex: Object.fromEntries(units.map((unit, index) => [String(index + 1), [{ unit: unit.id, block: 0 }]])) };
  const provenance = { schemaVersion: 1, producedBy: "build/build-app.sh via .github/workflows/build-siddur.yml", sourceRepo: "Synthetic/ServiceSource", sourceSha: "1".repeat(40), sourceShaShort: "1111111", sourceRef: "refs/heads/main",
    builtAt: "2026-10-16T00:00:00Z", runId: "123", runUrl: "https://github.com/Synthetic/ServiceSource/actions/runs/123", bookCount: 1, books: ["legacy-beit-mitzvah"], lane: "licensed", laneWhy: "Synthetic restricted content" };
  const feedBytes = Buffer.from(JSON.stringify(feed)), provenanceBytes = Buffer.from(JSON.stringify(provenance)), hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  const pins: ServiceFeedPins = { feedSha256: hash(feedBytes), provenanceSha256: hash(provenanceBytes), artifactRepo: "Synthetic/ServiceSource", artifactCommit: "1".repeat(40), artifactRunId: "123", sourceGitSha: "abcdef1-LICENSED" };
  return { feedBytes, provenanceBytes, pins, identity: parseServiceFeed(feedBytes, provenanceBytes, pins).identity, first, hidden, second, evening };
}
