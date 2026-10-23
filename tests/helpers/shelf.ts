// Invented link rows in the shape of Sefaria's /api/links answer (with_text=0): titles and citations only.
// Real work names are used where the curated lists match on them; no text of any work appears.
let id = 0;
export function linkRow(input: { index: string; category: string; ref: string; title?: string | null; he?: string | null; dates?: unknown; anchor?: string; expanded?: unknown; extra?: Record<string, unknown> }) {
  id++;
  const row: Record<string, unknown> = { _id: `synthetic${String(id).padStart(6, "0")}`, index_title: input.index, category: input.category, type: input.category.toLowerCase(), ref: input.ref,
    anchorRef: input.anchor ?? "Genesis 12:1", anchorRefExpanded: input.expanded ?? [input.anchor ?? "Genesis 12:1"], sourceRef: input.ref, sourceHeRef: "synthetic", anchorVerse: 1, sourceHasEn: true,
    commentaryNum: 1, ...input.extra };
  if (input.dates !== undefined) row.compDate = input.dates;
  if (input.title !== null) row.collectiveTitle = { en: input.title ?? input.index, ...(input.he === undefined ? {} : { he: input.he }) };
  return row;
}
/** A verse's links across every group, for the Torah verse Genesis 12:1. */
export function syntheticLinks() {
  return [
    linkRow({ index: "Synthetic Commentator on Genesis", title: "Synthetic Commentator", category: "Commentary", ref: "Synthetic Commentator on Genesis 12:1:1", dates: [1100, 1150] }),
    linkRow({ index: "Ramban on Genesis", title: "Ramban", he: "רמב״ן", category: "Commentary", ref: "Ramban on Genesis 12:1:1", dates: [1246, 1270] }),
    linkRow({ index: "Ramban on Genesis", title: "Ramban", he: "רמב״ן", category: "Commentary", ref: "Ramban on Genesis 12:1:2", dates: [1246, 1270] }),
    linkRow({ index: "Ramban on Genesis", title: "Ramban", he: "רמב״ן", category: "Commentary", ref: "Ramban on Genesis 12:1:3", dates: [1246, 1270] }),
    linkRow({ index: "Ramban on Deuteronomy", title: "Ramban", category: "Commentary", ref: "Ramban on Deuteronomy 8:3:1", dates: [1246, 1270] }),
    linkRow({ index: "Rashi on Genesis", title: "Rashi", he: "רש״י", category: "Commentary", ref: "Rashi on Genesis 12:1:1", dates: [1075, 1105] }),
    linkRow({ index: "Early Synthetic Commentary", category: "Commentary", ref: "Early Synthetic Commentary 3:4", dates: [900] }),
    linkRow({ index: "Midrash Tanchuma", category: "Midrash", ref: "Midrash Tanchuma, Lech Lecha 3:1", dates: [500, 800] }),
    linkRow({ index: "Bereshit Rabbah", category: "Midrash", ref: "Bereshit Rabbah 39:4", dates: [300, 500] }),
    linkRow({ index: "Synthetic Midrash", category: "Midrash", ref: "Synthetic Midrash 2:2" }),
    linkRow({ index: "Mishneh Torah, Synthetic Laws", category: "Halakhah", ref: "Mishneh Torah, Synthetic Laws 1:1", dates: [1170, 1180] }),
    linkRow({ index: "Jerusalem Talmud Synthetic", category: "Talmud", ref: "Jerusalem Talmud Synthetic 1:1:2" }),
    linkRow({ index: "Synthetic Tractate", category: "Talmud", ref: "Synthetic Tractate 16b:7" }),
    linkRow({ index: "Mishnah Synthetic", category: "Mishnah", ref: "Mishnah Synthetic 1:1" }),
    linkRow({ index: "Tosefta Synthetic", category: "Tosefta", ref: "Tosefta Synthetic 1:1" }),
    linkRow({ index: "Tafsir Synthetic", category: "Targum", ref: "Tafsir Synthetic, Genesis 12:1" }),
    linkRow({ index: "Onkelos Genesis", category: "Targum", ref: "Onkelos Genesis 12:1" }),
    linkRow({ index: "Synthetic Chasidut", category: "Chasidut", ref: "Synthetic Chasidut, Lech Lecha 1" }),
    linkRow({ index: "Synthetic Chasidut", category: "Chasidut", ref: "Synthetic Chasidut, Lech Lecha 2" }),
    linkRow({ index: "Other Chasidut", category: "Chasidut", ref: "Other Chasidut 4" }),
    linkRow({ index: "Synthetic Kabbalah", category: "Kabbalah", ref: "Synthetic Kabbalah 1:2" }),
  ];
}
/** A v3 texts answer for one citation in Sefaria's default editions. */
export const sourceAnswer = (ref: string, versions: readonly Record<string, unknown>[], warnings: readonly unknown[] = []) => ({ ref, heRef: "synthetic", versions, warnings });
export const sourceVersion = (language: "he" | "en", title: string, text: unknown, license = "CC-BY") => ({ language, actualLanguage: language, versionTitle: title, license, text });
