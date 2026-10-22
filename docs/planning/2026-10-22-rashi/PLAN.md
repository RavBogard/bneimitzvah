# Verse commentary (Rashi and the Women’s Commentary): server and data layer

Daniel (2026-10-22, verbatim): "Each verse should have the option of seeing Rashi, as an expandable option/default."

Scope as landed on `claude/rashi`: the **server route, the Sefaria reader and sanitiser, the runtime wiring, and an unused client data hook**. The UI is **on hold**. Daniel wants it designed carefully so it doesn't get in the way of students preparing their reading, possibly behind a separate study mode. So this branch has no reading preference, no toolbar button, no per-verse control and no change to `annotations.tsx`, `reading-prefs.ts`, `reading-toolbar.tsx` or their CSS. Nothing a student sees changes.

The layer is general across commentaries. The product is widening into CRC's place to study and prepare leyning, and later it will show several (Ramban, Ibn Ezra, Sforno, midrashim). The registry holds **Rashi** and **The Torah: A Women’s Commentary** (key `womens`). Daniel ruled on licences on 2026-10-22: “use all, don't stress.” Each further work is added with its editions verified live.

## What exists

- `src/lib/readings/commentary.ts` is shared by the server and the browser. `COMMENTARY_WORKS` is a frozen registry. Each work has:
  - a Sefaria book-level index pattern (`"Rashi on {book}"`, `"The Torah; A Women's Commentary, {book}"`);
  - its `indexTitle`, `complex` flag and the three `sectionNames` that validation checks;
  - the corpora it covers;
  - pinned Hebrew and English editions in preference order, each with a licence and a credit line. Hebrew is `null` for an English-only work. The module also holds chapter parsing against `TANAKH_VERSE_COUNTS`, Sefaria URLs and the size limits. It contains no commentary text.
- `src/server/study/sefaria-runs.ts` is the shared sanitiser. It turns Sefaria HTML into text runs, keeping `{ text, bold?, italic? }`.
- `src/server/study/commentary.ts` holds the v3 request, strict payload validation, edition fallback and a bounded fetch: 5 s deadline, 1 MiB upstream cap, abort on the request signal. It takes an injectable `fetch`.
- Route `GET /api/public/commentary?work=<key>&chapter=<Book N>` (Rashi: Torah and Nevi'im; `womens`: Torah only) is in the exact public allowlist. It answers `{ work, chapter, verses: { "<n>": { comments: [{ hebrew: Run[] | null, english: Run[] | null }] } }, editions: [{ language, title, license, credit, url }] }`. Each `comments` entry is one Sefaria segment: a Rashi comment, or one Women's Commentary paragraph, in order. At least one language is present in each entry with `vercel-cdn-cache-control: public, s-maxage=2592000` (an hour when no edition is present).
- `PublicRuntime.commentary` is wired in `composePublicRuntime`, with no database. The isolated browser fixture serves a synthetic stub (`commentaryLoad`) and never calls Sefaria.
- `src/components/portal/workspace/study/commentary-api.ts` holds the browser's strict parse, its fetch and a framework-free chapter store. `use-commentary.ts` holds `useCommentaryChapters(work, verseRefs, enabled)`. Neither is imported by any reading surface yet.

## Decided here

1. GATE: UI held back (coordinator relaying Daniel, 2026-10-22). Proceeded with server, data and hook only, because those change nothing a student sees.
2. One general route, `/api/public/commentary`, keyed `["work", "chapter"]`, in place of a Rashi-only route. A work not in the registry is a 400, refused before any runtime or database opens.
3. The public pre-checks were restructured. The date check now applies only to routes whose keys include `date`, which is every route except commentary. Those routes are checked exactly as before, and the existing route tests are unchanged and green. Commentary gets its own cheap check: a registered work, a real chapter of a covered book, and the same canonical closed query (so `chapter=Genesis+1`, never `Genesis%201`).
4. Only Torah and Nevi'im books are accepted, because the readings never include Ketuvim. Any Ketuvim book, any out-of-range chapter and any malformed chapter is a 400.
5. Rashi editions (titles and licences verified live on 2026-10-22 for every Torah and Nevi'im book via `https://www.sefaria.org/api/texts/versions/Rashi_on_<Book>`):
   - Torah Hebrew: "Pentateuch with Rashi's commentary by M. Rosenbaum and A.M. Silbermann, 1929-1934" (Public Domain), then "... -- corrected vocalization" (Public Domain), then "On Your Way" (Public Domain).
   - Torah English: the same Silbermann edition (Public Domain).
   - Nevi'im Hebrew: "Vocalized Edition" (CC0), then "On Your Way" (Public Domain), then "On Your Way -- new" (Public Domain).
   - Nevi'im English: "The Judaica Press complete Tanach with Rashi, translated by A. J. Rosenberg" (CC-BY), then "The Metsudah Tanach series, Lakewood, N.J" (CC-BY), then "The Book of Joshua, Metsudah Publications, 1997" (CC-BY).
   - **Beyond the original brief, and flagged for Daniel**, three editions were added, each only as a later fallback:
     - The Silbermann "corrected vocalization" Hebrew (Public Domain). Numbers has no plain Silbermann Hebrew, and this keeps the Hebrew paired with the same edition's English.
     - "On Your Way -- new" (Public Domain). I Kings and II Kings have neither Vocalized nor "On Your Way", so without it the many Kings haftarot would have no Hebrew Rashi.
     - The Metsudah *Book of Joshua* (CC-BY, the same publisher and licence as the approved Metsudah Tanach). Joshua has neither Judaica Press nor the Metsudah Tanach series, so without it the Joshua haftarot would have no English.
     - To remove any of these, delete one line in `COMMENTARY_WORKS`.
6. Every pinned edition for the corpus is requested in one v3 call. Sefaria returns the editions it has and a warning (code 101) for each one it lacks. Validation requires every requested edition to be either returned or warned, and nothing else. For each language, the first edition in preference order with any comment in the chapter is used. A chapter with no edition is an empty answer, not an error.
7. Chapter-level v3 commentary text is a depth-3 jagged array `[verse][comment]` of strings. Some chapters are padded past the last verse; Exodus 12 English has 430 slots for 51 verses. Padding is accepted only while it is empty, and slots are capped at 1000. Hebrew and English comment *n* of a verse are the same Sefaria segment address, so they pair by index. Comments are capped at 60 per verse, runs at 400 per comment, each string at 16 KiB, and the normalized chapter at 512 KiB.
8. Sanitising, done server-side:
   - `<b>` and `<strong>` become bold runs.
   - `<sup>` (any), `<i class="footnote">` and script, style and similar elements are dropped with their content.
   - Every other tag keeps its text.
   - Entities are decoded by parse5. C0/C1 controls, the BOM and bidi overrides are stripped. Whitespace collapses and text is NFC.
   - The browser re-validates the exact shape and treats runs as text only.
9. There is no server-side cache: the CDN keeps each chapter for 30 days. Failures are 503 `no-store`. The hook is quiet on failure (the verse reports `failed`), fetches after render, aborts on page change or unmount, fetches each chapter at most once per store (two at a time), and fetches nothing when `enabled` is false.

10. The Torah: A Women's Commentary (`womens`), verified live on 2026-10-22:
    - Edition: English only, "CCAR Press and Women of Reform Judaism, 2008", licence CC-BY-NC. It is credited as "The Torah: A Women's Commentary (CCAR Press and Women of Reform Judaism, 2008), via Sefaria (CC BY-NC)".
    - Coverage: Torah books only.
    - Shape: a complex index. `book` is "The Torah; A Women's Commentary, <Book>", `indexTitle` is "The Torah; A Women's Commentary", `isComplex` is true and `sectionNames` are Chapter/Verse/Paragraph, at depth 3.
    - Paragraphs mix italic titles, capitalized section headings and prose. They stay one entry per paragraph, in order, with italic and bold runs kept so the UI can style headings.
11. The sanitiser now also emits italic runs (`<i>`/`<em>`, other than footnotes). Rashi's English editions gain italics where Sefaria marks them.
12. Fixtures are synthetic only. Live validation was run once, outside the repository, against Sefaria: Rashi on 16 chapters across the Torah and Nevi'im, including the fallback books Numbers, Joshua and Kings, and the Women's Commentary on five chapters, one per book. Every chapter parsed with no markup left. No live text was saved.

13. An adversarial review (a second agent, read-only, 2026-10-22) found no blocker. It confirmed:
    - No pre-existing public route was loosened.
    - The commentary route refuses every non-canonical, credentialed, ranged or non-GET request.
    - Prototype keys are refused.
    - Nothing renders as HTML.
    - Fixtures are synthetic, and never-in-repo is green.
    - Live, Rashi validates on all 567 Torah and Nevi'im chapters.

    Fixed from its findings:
    - **Slots past the last verse.** Text there is now shape-checked and left out, never fatal. This was found because the Women's Commentary, Numbers 25, has a nineteenth slot with paragraphs and 503'd every time; it now serves.
    - **Shared store.** The chapter store is now safe to share. Every listener hears every change; a fetch is aborted only when no consumer wants it; an aborted fetch frees its slot at once; a failure is retried after 60 s.
    - **Hook loop.** The hook no longer loops when handed a store for another work.
    - **Credit in the response.** Each served edition now carries its registry `credit` line, which states the licence, "via Sefaria" and the changes made. The browser checks it against the registry.
    - **Empty answers.** An answer with no edition is CDN-cached for an hour, not thirty days.
    - **Invisible characters.** The sanitiser also strips interlinear annotation characters and the Unicode tag block. Direction marks stay, because they are real in Rashi's Hebrew.
    - **Literal bidi characters.** These had slipped into the sanitiser's regex and one test as literal characters. They are now written as `\u` escapes.

## Open items that wait on Daniel

- The study UI: where commentary appears (inline per verse, a side panel, or a study mode separate from leyning practice), its default, and the credit wording. The data layer supports any of these.
- Which commentary comes next. Each is added with its editions verified live. (The three fallback editions in Decided 5 stand under Daniel's 2026-10-22 ruling, "use all, don't stress".)
