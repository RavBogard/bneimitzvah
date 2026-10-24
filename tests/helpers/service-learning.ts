import { createHash } from "node:crypto";
import { parseServiceFeed, type ServiceFeedPins } from "../../src/server/service-learning/feed";
/** standard: also carry units under the feed's stable ids for two standard parts (morning) and one (evening).
 * firstPage: the printed page of the first unit, each later unit one page on (default 1); false: no unit has a printed page. */
export function syntheticServiceCatalog(seed = "one", options: { standard?: boolean; firstPage?: number | false } = {}) {
  const family = "bm-shacharit", first = `sample.first@${family}`, hidden = `sample.hidden@${family}`, second = `sample.second@${family}`, evening = "sample.evening@bm-maariv";
  const standard = { torahBefore: `torah.blessing-before-the-torah-reading@${family}`, vahavta: `shma.vahavta@${family}`, eveningShma: "shma.the-shma@bm-maariv" };
  const ids = options.standard ? [first, standard.vahavta, hidden, second, standard.torahBefore, evening, standard.eveningShma] : [first, hidden, second, evening];
  const firstPage = options.firstPage ?? 1, pages = Math.max(8, firstPage === false ? 0 : firstPage + ids.length);
  const units = ids.map((id, index) => ({ id, name: `Synthetic part ${index}`, section: id.endsWith("@bm-maariv") ? 1 : 0,
    caption: `Synthetic caption ${index}`, group: null, folios: [index + 1], ...(firstPage === false ? {} : { printedFolio: firstPage + index }),
    ...(id === hidden ? { companionOf: first, companionRole: "preparation" } : {}),
    blocks: [{ type: "stanza", he: "א֑ב\u200f", bare: "אב", tr: "omitted-synthetic", en: [{ t: `Synthetic translation ${index}` }, { footnote: [{ t: "Synthetic credit" }] }], folio: index + 1, phys: index + 1 },
      { type: "english", role: "original", en: `Synthetic original ${index}.`, footnote: [{ em: [{ t: "Synthetic note" }] }], folio: index + 1, phys: index + 1 }] }));
  const feed = { schemaVersion: 1, volume: "legacy-beit-mitzvah", title: `Synthetic service ${seed}`, blockGranularity: "line",
    printing: { gitSha: "abcdef1-LICENSED", pages, builtAt: "2026-10-15T00:00:00Z", source: { gitSha: "abcdef1-LICENSED", pages, builtAt: "2026-10-15T00:00:00Z", lane: "licensed" } },
    license: { spdx: "LicenseRef-Synthetic", attribution: "Synthetic CRC-only credit" }, sections: [{ idx: 0, en: "Synthetic morning", opener: true }, { idx: 1, en: "Synthetic evening", opener: false }], units,
    front: [{ type: "rubric", text: [{ t: "Unselected synthetic front" }] }],
    pageIndex: Object.fromEntries(units.map((unit, index) => [String(index + 1), [{ unit: unit.id, block: 0 }]])) };
  const provenance = { schemaVersion: 1, producedBy: "build/build-app.sh via .github/workflows/build-siddur.yml", sourceRepo: "Synthetic/ServiceSource", sourceSha: "1".repeat(40), sourceShaShort: "1111111", sourceRef: "refs/heads/main",
    builtAt: "2026-10-16T00:00:00Z", runId: "123", runUrl: "https://github.com/Synthetic/ServiceSource/actions/runs/123", bookCount: 1, books: ["legacy-beit-mitzvah"], lane: "licensed", laneWhy: "Synthetic restricted content" };
  const feedBytes = Buffer.from(JSON.stringify(feed)), provenanceBytes = Buffer.from(JSON.stringify(provenance)), hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  const pins: ServiceFeedPins = { feedSha256: hash(feedBytes), provenanceSha256: hash(provenanceBytes), artifactRepo: "Synthetic/ServiceSource", artifactCommit: "1".repeat(40), artifactRunId: "123", sourceGitSha: "abcdef1-LICENSED" };
  return { feedBytes, provenanceBytes, pins, identity: parseServiceFeed(feedBytes, provenanceBytes, pins).identity, first, hidden, second, evening, standard };
}
