---
version: 1
slug: "src-app-trope-chart-page-tsx"
primary_target: "src/app/trope-chart/page.tsx"
related_targets: ["src/app/trope-chart/chart.module.css","src/components/portal/trope-chart/print.tsx","src/lib/trope/chart-catalog.ts","src/styles/hebrew-font.module.css","public/fonts/PROVENANCE.md"]
---

# Public trope chart

Mode: Read. Primary target `/trope-chart`, a static public reference without student, tenant or account payloads. This is the code-first continuation of Annotated score, Daniel's selected world from seed75c22686; no new chooser, seed, comp or shipping raster asset.

## Direction contract

THESIS: Find a sign by its real glyph and name, understand its contextual phrase family, and print a readable reference.

OWN-WORLD: Preserve the incumbent white field, ink, fine rules, restrained burgundy actions, teal focus and system UI headings/English/controls. Pale source family colors supplement names; color never carries identification alone. Real Hebrew text is the material, without decorative notation, audio placeholders or a new global font/token palette.

STORY: A visitor scans named family groups, checks contextual signs and their codepoints, then explicitly prints after the local Hebrew font loads. Return to workspace is an ordinary navigation link. Entering this public reference from a private reading is mediated by that workspace's controlled departure review.

FIRST VIEWPORT: Compact congregation masthead/return link precede title, short explanation, print action/status and phrase-family heading. Two family columns on desktop become one at 640px; the contextual inventory changes from four columns to two. Names wrap and source/codepoint details remain available. Phone 200% text enlargement reflows vertically without horizontal overflow in the bounded Chromium evidence.

FORM: Open ruled groups, real RTL sample text and visible English names, not cards or decorative illustration. Preserve all 30 marks and eleven named family groups. Print is a deliberate compact adaptation of this same reference.

FINISH: The fresh reviewer returned **ship** for the scored recovery-copy and persistence fixes in the bounded editor/chart review. Local checks/captures are evidence for this increment, not security, real-provider, publication or student-release approval.

## Catalog and meaning

`src/lib/trope/chart-catalog.ts` mirrors the existing engine registry and phrase-family order. The eleven family colors are source data from haftarah's trope CSS: zakef `#fff176`, etnachta `#9ec5ff`, sof-pasuk `#f59a9a`, revia `#ffc078`, tevir `#9be29b`, segol `#eaa0ea`, azla `#ffd2d2`, telisha-ketana `#ffb3c6`, pazer `#d3c1ff`, zakef-gadol `#ffd9a3` and sof-haftarah `#66c2c2`. These are chart-local catalog colors, not new global interface tokens.

All 30 U+0591–U+05AE entries appear once in the inventory with English engine-derived names and screen codepoint labels; both zarka codepoints remain distinct. Fourteen marks appear under their closing-family groups; sixteen appear in the contextual inventory. Phrase color belongs to the whole phrase rather than giving each accent a permanent color or melody. Folded signs join their following phrase; conjunctives inherit context; ole/dehi are identified as additional poetic-system marks. The two verse-ending examples use silluq/sof pasuq; the final-haftarah family is a context variant, not a new accent. The revia group also explains munach+paseq legarmeh. All glyph samples use an invented letter/vowel carrier, not scripture. There is no audio, melody payload or generated-chant request.

## Local content typography and font readiness

Hebrew samples carry `lang="he"`, explicit RTL direction and the shared content-only `.hebrew` class. `CRC Noto Serif Hebrew` is the local face name for approved Noto Serif Hebrew 2.004, followed by `Noto Serif Hebrew`, `Times New Roman`, serif. The font is loaded only from `/fonts/noto-serif-hebrew/NotoSerifHebrew.ttf`; the complete adjacent `OFL.txt` is SIL Open Font License 1.1, with byte pins, provenance and retained copyright notice. No font bytes, names or license terms were modified. English and controls keep the existing system UI stack.

Screen samples are 2rem with line height 2 and weight 400, no synthesized face, mark/mkmk features. Family headings are 1.125rem; codepoints 0.8125rem; sources 0.875rem. These are local reference sizes, not a new global type ramp. The print action remains disabled during loading, becomes available only after a nonempty successful FontFaceSet load/check covering all 30 marks plus ending signs, and rechecks before `window.print()`. Failure names the font problem and offers explicit reload; it never claims print readiness from a declared CSS family alone.

## Printable composition and bounded evidence

Print uses 12mm margins, **three family columns** and **eight contextual-sign columns**. Family glyphs remain 22pt, contextual glyphs 20pt and names 10pt; family headings 11pt, section headings 12pt, title 20pt and source notice 8.5pt. Navigation/print controls and screen codepoints are hidden; every glyph/name/context/source notice remains. The original two-family-column print output was two pages; the single measured correction changed grouping density without shrinking the glyphs/names. Background-disabled printing genuinely removes fills and preserves all sign/name identification.

The confirmation packet establishes **one page each on Letter and A4**, plus one background-disabled Letter page, with readable wrapped long names and no observed clipping/overlap. Chromium embeds Noto as Type3 vector glyph programs with FontDescriptor names and ToUnicode maps, rather than embedding the raw TTF; all 30 accent codepoints extract. Actual same-origin custom Noto use is separately checked in Chromium. Normal desktop/phone and phone 200% evidence are synthetic; text enlargement is not physical-device pinch zoom.

Sources and exact ignored artifact paths are recorded in `docs/planning/2026-10-15-kickoff/TROPE-CHART-RETURN.md`; browser checks live in `e2e/trope-chart.spec.ts`, catalog parity checks in `tests/trope-chart-catalog.test.mjs`, and review in `EDITOR-CHART-FINISH-REVIEW.md`. Physical printing, other browser/PDF engines, full-corpus cantillation fidelity and musical pedagogy were not established. This reference does not release generated chant or supersede independent security/release gates.
