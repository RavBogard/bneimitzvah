import { createHash } from "node:crypto";
import { parseServiceFeed, type ServiceFeedPins } from "../../src/server/service-learning/feed";
import { EVENING_TEXT_UNITS } from "../../src/lib/service-course/course";
import type { EveningTextPin } from "../../src/server/service-course/evening";

/**
 * A synthetic licensed Beit Mitzvah catalog for the evening lessons' tests (2.0 SC7): every Saturday-evening unit the course names,
 * plus a morning unit, an evening unit no lesson names and a Saturday-evening Mi Shebeirach, none of which may ever be served. Each
 * named unit carries the shapes the real book prints, with synthetic words only: a labelled kavannah and an epigraph before the
 * prayer, two lines of Hebrew with their transliteration, a song lyric with no Hebrew, a row whose "transliteration" is a credit, the
 * translation with its own credit line, and a rubric. No real prayer text is here.
 */
export const SYNTHETIC_HE = ["\u05D0\u05D1 \u05D2\u05D3", "\u05D4\u05D5 \u05D6\u05D7 \u05D8\u05D9"] as const;
export const SYNTHETIC_TR = ["av gad", "hu zach ti"] as const;
const named = [...EVENING_TEXT_UNITS].sort();
const blocks = (i: number) => [
  { type: "english", en: "Synthetic kavannah.", label: "Kavannah", verse: "Kavannah" },
  { type: "english", en: "Synthetic epigraph before the prayer." },
  { type: "stanza", he: SYNTHETIC_HE[0], bare: "\u05D0\u05D1 \u05D2\u05D3", tr: SYNTHETIC_TR[0] },
  { type: "stanza", he: "", bare: "", tr: "Synthetic song lyric with no Hebrew" },
  { type: "stanza", he: SYNTHETIC_HE[1], bare: "\u05D4\u05D5 \u05D6\u05D7 \u05D8\u05D9", tr: SYNTHETIC_TR[1] },
  { type: "stanza", he: "\u05DB\u05DC", bare: "\u05DB\u05DC", tr: "~ Synthetic credit row" },
  { type: "english", en: `Synthetic translation ${i}.` },
  { type: "english", en: "~ Synthetic translator" },
  { type: "english", en: "Synthetic note about the next prayer.", label: "Kavannah", verse: "Kavannah" },
  { type: "rubric", text: [{ t: "Synthetic rubric" }] },
];
export function syntheticEveningCatalog(seed = "one") {
  const extra = ["shma.the-shma@bm-shacharit", "sample.unnamed@bm-maariv", "torah.mi-shebeirach-healing@bm-maariv"];
  const ids = [...named, ...extra], pages = 64;
  const units = ids.map((id, index) => ({ id, name: `Synthetic part ${index}`, section: id.endsWith("@bm-maariv") ? 1 : 0, group: null, printedFolio: Math.min(pages, 33 + index), blocks: blocks(index) }));
  const feed = { schemaVersion: 1, volume: "legacy-beit-mitzvah", title: { en: `Synthetic book ${seed}`, he: "\u05D0\u05D1" }, blockGranularity: "line",
    printing: { gitSha: "abcdef1-LICENSED", pages, builtAt: "2026-10-15T00:00:00Z", source: { gitSha: "abcdef1-LICENSED", pages, builtAt: "2026-10-15T00:00:00Z", lane: "licensed" } },
    license: { spdx: "LicenseRef-Synthetic", attribution: "Synthetic congregation credit, for this congregation only." },
    sections: [{ idx: 0, en: "Synthetic morning", opener: true }, { idx: 1, en: "Synthetic evening", opener: false }], units, pageIndex: {} };
  const provenance = { schemaVersion: 1, producedBy: "build/build-app.sh via .github/workflows/build-siddur.yml", sourceRepo: "Synthetic/ServiceSource", sourceSha: "1".repeat(40), sourceShaShort: "1111111", sourceRef: "refs/heads/main",
    builtAt: "2026-10-16T00:00:00Z", runId: "123", runUrl: "https://github.com/Synthetic/ServiceSource/actions/runs/123", bookCount: 1, books: ["legacy-beit-mitzvah"], lane: "licensed", laneWhy: "Synthetic restricted content" };
  const feedBytes = Buffer.from(JSON.stringify(feed)), provenanceBytes = Buffer.from(JSON.stringify(provenance)), hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  const pins: ServiceFeedPins = { feedSha256: hash(feedBytes), provenanceSha256: hash(provenanceBytes), artifactRepo: "Synthetic/ServiceSource", artifactCommit: "1".repeat(40), artifactRunId: "123", sourceGitSha: "abcdef1-LICENSED" };
  const identity = parseServiceFeed(feedBytes, provenanceBytes, pins).identity;
  const pin: EveningTextPin = { identity, ...pins };
  return { feedBytes, provenanceBytes, pins, identity, pin, named, extra };
}
