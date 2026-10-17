import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { planStudyPage } from "../../src/server/study/sefaria";
import { normalizeHebrew } from "../../src/server/study/normalize";
import { MAM, JPS2023 } from "../../src/server/study/versions";
import type { StudyRequest, StudyPage } from "../../src/server/study/types";

// Invented single-letter syllables and numbered labels, never a passage fixture.
export function syntheticUiStudyPage(request: StudyRequest, english: "available" | "partial" | "unavailable" = "partial"): StudyPage {
  const plan = planStudyPage(request, TANAKH_VERSE_COUNTS);
  const verses = plan.refs.map((ref, index) => ({ ref,
    hebrew: normalizeHebrew('אָ֑ב <span class="mam-kq"><span class="mam-kq-k">זָ</span><span class="mam-kq-q">[גַּ]</span></span><span class="mam-spi-samekh">{ס}</span>'),
    english: english === "unavailable" || english === "partial" && index === 1 ? null : `Synthetic reference ${request.offset + index + 1}: <img src=x onerror=synthetic()>` }));
  const count = verses.filter(row => row.english !== null).length;
  return { offset: request.offset, nextOffset: plan.nextOffset, totalVerses: request.verses.length, verses,
    translation: { key: "jps2023", status: count === verses.length ? "available" : count === 0 ? "unavailable" : "partial" },
    chapters: plan.chapters.map(chapter => ({ ref: chapter.ref, sefariaUrl: `https://www.sefaria.org/${encodeURIComponent(chapter.book)}.${chapter.number}`, fetchedAt: Date.now(), hash: "c".repeat(64), editions: english === "unavailable" ? [MAM] : [MAM, JPS2023] })) };
}

// Repeated invented syllables exercise wrapping and scrolling without copying a passage.
export function syntheticUiLongStudyPage(request: StudyRequest): StudyPage {
  const page = syntheticUiStudyPage(request);
  const hebrew = normalizeHebrew(`${Array.from({ length: 12 }, () => "אָ֑ב גַּ֖ד דָּ֥ה הַֽו").join(" ")} <span class="mam-kq"><span class="mam-kq-k">זָ</span><span class="mam-kq-q">[גַּ]</span></span><span class="mam-spi-samekh">{ס}</span>`);
  return { ...page, verses: page.verses.map((verse, index) => index === 0 ? { ...verse, hebrew } : verse) };
}
