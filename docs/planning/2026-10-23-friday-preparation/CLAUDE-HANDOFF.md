# Claude handoff for CRC Torah reading and study

Daniel approved this product direction after an outside-consultant review and alignment interview. Apply it after your current commitments, reconciling it with the work you have already integrated. You retain implementation and integration ownership. Astra's work here is consultation and documentation.

## Start here

1. Read [PLAIN-LANGUAGE-PLAN.md](PLAIN-LANGUAGE-PLAN.md) for the agreed experience.
2. Read this handoff for scope, priorities, and completion checks.
3. Use [CONSULTANT-PLAN.md](CONSULTANT-PLAN.md) for source evidence and detailed rationale, and [STATE.md](STATE.md) as the return point.

The files are local and uncommitted in `C:/Users/dsbog/bneimitzvah/docs/planning/2026-10-23-friday-preparation/`. They may be absent from your active worktree. Read them at that absolute path or copy only this planning folder into your worktree. Do not copy, reset, stash, or broadly stage the older dirty checkout.

Use your existing integration workflow. This handoff does not require another coding stream or a new worktree. The 2026-10-18 UX handoff is historical background; its old baseline, ownership split, unfinished-feature list, and instruction to create a new worktree are not current operating instructions.

Read current repository instructions and your current release/coordination state. Preserve ongoing work and the existing release, spending, content, repository-protection, and independent-review requirements. Reuse completed work instead of restarting the audit or mission interview.

## The mission and the important correction

CRC Torah is for anyone at CRC preparing to read, understand, translate, or teach a Torah passage. Daniel's regular leining and drashing preparation, ordinary congregant exploration, learning to lein, and Beit Mitzvah preparation all matter.

**Custom readings are common. Custom study guides are rare.** The everyday experience is opening a portion, exploring its text and original commentary, choosing verses, preparing them, and printing what is useful. It works entirely in the app. Working with Claude is another entrance into that same experience.

Do not center the app on preparing a custom guide, answering theme questions, managing source collections, or writing a teaching. Occasional guided study with a rabbi can use MCP-authored material displayed where relevant.

## Confirmed behavior

- **Start with the parashah.** Normally show the whole portion. A selection made in Claude opens those exact verses directly in Study.
- **Choose any reading.** Select verses while reading or use precise passage controls. Support separated groups and easy revision. Daniel's usual 7–15 verses is an example, not a limit.
- **Keep context.** Make the selected verses and whole portion easy to move between. Preserve the selection and a recognizable location through Study, Lein, reopening, and Print.
- **Support independent exploration.** A person can read Hebrew and English, open Rashi and other commentators, follow related sources, and return to the passage without a prior Claude session or custom guide.
- **Match word actions to the activity.** Study opens meaning, with grammar accessible. Lein hears the reading by default. Both modes retain access to the other tools.
- **Show original commentary in English.** Keep source identity, reference, edition/translator credit, full-source expansion, and original-context links clear. The Torah text retains Hebrew and English. Important sources without an English translation can receive a credited Claude translation added through MCP.
- **Keep writing in Claude.** Cut My notes and My translation from the normal personal reader, and repair links that lead into those fields. Preserve stored work and the author's access to it. This decision does not automatically remove separate tutor-assigned student exercises.
- **Give Claude useful preparation access.** Daniel wants Claude to work with all of his preparation when asked. Support the data that actually exists; add no new notebooks, personal source-library system, or translation-drafting workflow merely to populate MCP tools.
- **Print the chosen reading.** Reuse the print-sheet work already underway. Optional selected original commentary follows the bilingual reading, on additional pages.
- **Keep existing student guides secondary.** They remain available when useful and do not determine the ordinary reader's structure.

## Occasional curation through MCP

The rabbi names a question or theme and works with Claude to select original sources. Use MCP as the authoring route. The ordinary app needs no guide editor or question builder.

Where a curated discussion exists, it may appear beside its verses and through an optional list of its questions. Do not invent or require a question list for every portion. The discussion contains the question/title, original source passages in English, and attribution. **No introductions, connecting essays, or generated synthesis.** Existing student guides are the secondary exception, not the model for the main source experience.

Telling Claude to add the material means publish it for everyone; no routine second publish step. Preserve truthful translator and review attribution. Publishing source material never publishes private personal preparation.

Implement this occasional workflow after the ordinary reading and exploration experience is coherent. The mere existence of a guide model or MCP endpoint does not establish that all of the required source-only behavior is already supported.

## UI references and design freedom

Keep the approved Annotated score direction and current product identity. Daniel specifically requested inspiration from Sefaria and his haftarah repo.

- **Sefaria:** [Genesis with Rashi](https://www.sefaria.org/Genesis.12?lang=bi&with=Rashi). Useful interactions are the visible passage beside a source panel, commentary following the selected verse, recognizable references, and a route to related-text categories.
- **Haftarah:** [live reader](https://haftarah.centralreform.org/2026-10-17-noach); read-only source at `C:/Users/dsbog/haftarah`. Useful patterns are nearby word/source panels, plain-language word explanation before deeper dictionary detail, full-source expansion, and focus returning to the opener. Relevant files: `site/app/sheet.js`, `panel.js`, `sefaria.js`, `words.js`, `a11y.js`, and `site/web.css`.

The haftarah repo stays read-only. Its introductory essays and bilingual commentary panels are not the current CRC Torah requirements. Borrow interactions and adapt them to the current design and English commentary.

Exact selection gestures, panel composition, chapter navigation, source density, and appendix grouping are routine design work. A quieter initial trope-color setting in Study is a consultant recommendation, not a separately confirmed rule. Do not present these details as answers Daniel already gave, and do not reopen the visual-world choice.

## Recommended implementation order

### Reconcile current work

Check the current integrated source once against the acceptance outcomes. The consultant reviewed reader main at `e63a661`; remote main later advanced to `fa32d86`. The print branch was seen at `391ccfa`, then `db433ab` after a main merge. These are historical evidence checkpoints, not instructions to reset to or branch from them. Print and learning work were active during the consultation.

Record a short list of what is already satisfied, what needs frontend work, and what needs a new contract. Reuse existing components and your current commitments.

### Complete common custom readings

Make choosing, revising, saving, and reopening a custom reading easy in the app. Connect it to the full portion and preserve it across Study, Lein, and the integrated print feature. Include the Claude-to-reader handoff without making it a prerequisite for ordinary exploration.

### Improve ordinary exploration

Make original commentary and related sources easy to follow without losing the verse. Bring word meaning close to the text in Study and retain default hearing in Lein. Provide useful chapter/reference orientation and a practical keyboard path through a long portion.

### Simplify personal surfaces and connect Claude

Remove the normal personal writing controls and resolve their dependent links. Preserve stored work. Introduce the minimum owner-authorized MCP contract needed to work with existing preparation data.

The current saved-data layer intentionally excludes staff MCP access, enforced in `src/server/saved/access.ts` and `tests/saved-structure.test.mjs`. The product decision authorizes designing the person's own preparation access; it does not authorize staff access to everyone's private work. Update the access contract and its protections together, with the standing independent adversarial review. Do not weaken a structural guard merely to make a new import pass.

### Finish output and occasional guided study

Extend the integrated print work with the optional commentary appendix. After the common journey works, add the rare source-only MCP curation and translated-source publication needed for guided study. Avoid a general collection-management or guide-authoring product.

## Acceptance checks

Use existing synthetic fixtures for automated work and Daniel for the permitted human checks. Demonstrate complete journeys, including interruptions and changes, rather than only individual components.

1. Start with the whole portion, explore original commentary, select and save a passage, revise it, and reopen it entirely in the app, with no custom guide or Claude session.
2. Choose a reading in Claude and open exactly that selection in Study. Move to the whole portion and back; switch to Lein and Print without rebuilding the selection.
3. Select separated verse groups and revise boundaries without losing prior saved work or misreporting the final references/count.
4. Tap a word in Study to see meaning without starting audio or traveling to the end of the portion. Tap in Lein to hear the reading by default.
5. Open a source in full, inspect its reference/credit, and return to the same verse. Exercise phone-width, larger-text, keyboard, and responsive-panel behavior.
6. Confirm that removed personal writing controls leave no broken entry actions and that stored work stays within the author's authority. Verify the planned MCP ownership and cross-person denial behavior independently.
7. Print the current selected Hebrew and English. Turn the optional commentary appendix on and off; check source order, page breaks, larger text, and attribution.
8. As an occasional case, add a curated discussion through MCP with no required introduction. It appears through both relevant entrances, is available to everyone, and publishes no private preparation. A Claude translation carries accurate credit.
9. Keep existing student guides accessible secondarily and preserve student, family, and tutor practice journeys.

Run focused checks for changes and the repository-required broader checks at integration. Preserve meaningful repository/privacy tests. Historical screenshots and phone-width emulation do not establish actual iPhone, screen-reader, or physical-print acceptance.

## Return note

At each bounded milestone, update one short return note: completed user outcome, branch/commit and files, current verification, unresolved acceptance, and next action. Link history rather than repeating it. Ask Daniel only about a consequential unresolved product decision or an applicable real gate; do not repeat the mission interview or seek another visual direction.
