import "server-only";
import { createHash } from "node:crypto";
import { projectStudyVerse } from "../../lib/hebrew/study-tokens";
import { resolveReadingCoverage, type RecordingCheck, type RecordingCoverage } from "../../lib/reference-audio/reading-coverage";
import { shortSourceRange } from "../../lib/reference-audio/short-source";
import { shermetTextMatches, type ShermetTiming } from "../../lib/reference-audio/shermet-timing";
import { createReferenceTimeline, referenceWordLoop } from "../../lib/reference-audio/timeline";
import type { StudyRequest, StudyVerse, StudyPage } from "../study/types";
import { resolveReference, type ReferenceCatalog } from "./catalog";
import { findShortSource, readShortSourceEntry, type ShortSourceManifest } from "./short-source-manifest";

const missing: RecordingCoverage = { verse: "missing", word: "missing" };
const unknown: RecordingCoverage = { verse: "unknown", word: "unknown" };

function pocketTorahCoverage(catalog: ReferenceCatalog, manifest: ShortSourceManifest, verse: StudyVerse, reading: readonly string[]): RecordingCoverage {
  const resolved = resolveReference(catalog, verse, undefined, reading);
  const entry = findShortSource(manifest, resolved);
  if (!entry) return missing;
  const { source } = readShortSourceEntry(entry);
  const projection = projectStudyVerse(verse.ref, verse.hebrew);
  const bytes = Buffer.from(verse.hebrew.readingText.normalize("NFC"));
  const timeline = createReferenceTimeline(resolved.verse, { ref: verse.ref,
    readingTextSha256: bytes.length <= 8192 ? createHash("sha256").update(bytes).digest("hex") : undefined,
    wordCount: projection.status === "ready" ? projection.projection.words.length : 0 });
  if (!timeline || timeline.asset !== source.parent.asset) return missing;
  const words = timeline.starts?.every((_, index) => {
    const interval = referenceWordLoop(timeline, index);
    return interval && shortSourceRange(source, interval);
  });
  return { verse: "available", word: words ? "available" : "missing" };
}

export function createReadingCoverage(input: {
  learnerRelease: boolean;
  loadCatalog(signal?: AbortSignal): Promise<ReferenceCatalog>;
  loadManifest(signal?: AbortSignal): Promise<ShortSourceManifest>;
  loadText(request: StudyRequest): Promise<StudyPage>;
  shermetRecordings(refs: readonly string[]): Promise<ReadonlyMap<string, string>>;
  shermetTiming(ref: string): Promise<ShermetTiming | null>;
}) {
  return async (reading: Pick<StudyRequest, "kind" | "ranges" | "verses" | "signal">, offsets: readonly number[]) => {
    if (!input.learnerRelease) return { status: "listening-disabled" as const };
    const { verses, signal } = reading;
    // The catalog and its published short-verse manifest are metadata only.
    const outcomes = await Promise.allSettled([
      (async () => {
        const catalog = await input.loadCatalog(signal);
        const manifest = await input.loadManifest(signal).catch(() => null);
        const refs = new Set(catalog.assets.flatMap(asset => asset.verses.filter(verse => verse.playback.status === "ready").map(verse => verse.ref)));
        return { catalog, manifest, refs };
      })(),
      input.shermetRecordings(verses),
    ]);
    const pocket = outcomes[0].status === "fulfilled" ? outcomes[0].value : null;
    const shermet = outcomes[1].status === "fulfilled" ? outcomes[1].value : null;
    const timings = new Map<string, ShermetTiming | "unknown">();
    await Promise.all(verses.map(async ref => {
      const identity = shermet?.get(ref);
      if (!identity || signal?.aborted) return;
      try {
        const timing = await input.shermetTiming(ref);
        if (timing?.audioSha256 === identity) timings.set(ref, timing);
      } catch { timings.set(ref, "unknown"); }
    }));
    const text = new Map<string, StudyVerse>();
    let next = 0;
    async function loadPages() {
      while (!signal?.aborted && next < offsets.length) {
        const index = next++;
        const offset = offsets[index], after = offsets[index + 1] ?? null;
        const refs = verses.slice(offset, after ?? verses.length);
        const needsText = refs.some(ref => {
          const timing = timings.get(ref);
          return (timing !== undefined && timing !== "unknown") || (pocket?.manifest && pocket.refs.has(ref));
        });
        if (!needsText) continue;
        try {
          const page = await input.loadText({ ...reading, offset, translation: "jps2023" });
          if (page.offset !== offset || page.nextOffset !== after || page.totalVerses !== verses.length
            || page.verses.length !== refs.length || page.verses.some((verse, i) => verse.ref !== refs[i])) continue;
          for (const verse of page.verses) text.set(verse.ref, verse);
        } catch { /* A failed text check cannot claim coverage for affected verses. */ }
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, offsets.length) }, loadPages));

    function checkShermet(ref: string, verse: StudyVerse | undefined): RecordingCoverage {
      if (!shermet) return unknown;
      if (!shermet.has(ref)) return missing;
      const timing = timings.get(ref);
      let word: RecordingCheck = "missing";
      if (timing === "unknown") word = "unknown";
      else if (timing) {
        if (!verse) word = "unknown";
        else {
          const projection = projectStudyVerse(ref, verse.hebrew);
          if (projection.status === "ready" && shermetTextMatches(timing, { ref, wordCount: projection.projection.words.length,
            readingTextSha256: createHash("sha256").update(projection.projection.readingText.normalize("NFC")).digest("hex") })) word = "available";
        }
      }
      return { verse: "available", word };
    }
    return { status: "checked" as const, verses: verses.map(ref => {
      const verse = text.get(ref);
      const s = checkShermet(ref, verse);
      const p = !pocket ? unknown : !pocket.refs.has(ref) ? missing : verse && pocket.manifest
        ? pocketTorahCoverage(pocket.catalog, pocket.manifest, verse, verses) : unknown;
      return { ref, verse: resolveReadingCoverage(s.verse, p.verse), word: resolveReadingCoverage(s.word, p.word) };
    }) };
  };
}
