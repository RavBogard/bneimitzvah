# CRC Torah preparation plan

CRC Torah should be the starting place for anyone at CRC preparing to read, understand, translate, or teach a Torah passage. People can explore naturally in the app or prepare with Claude and open their reading there. Custom readings for learning to lein and Daniel's regular leining and drashing preparation are common, central uses. Ordinary congregants need an approachable way to read the portion and its main commentators. Beit Mitzvah students retain their guided preparation and practice experience.

Custom study guides and specially curated source discussions are occasional aids, especially when a rabbi studies with someone. Recommend authoring curation through MCP, with no guide editor or question-building workflow in the normal app. Strengthen ordinary reading and source exploration before adding machinery for these rare cases. The [plain-language plan](PLAIN-LANGUAGE-PLAN.md) is the quickest way to review the scope.

Daniel confirmed the direction below during this consultation. The implementation sequence and interaction details are consultant recommendations. This assignment produces a plan; Claude's active coding stream retains implementation ownership.

## Confirmed decisions

| Subject | Daniel's direction | Planning consequence |
| --- | --- | --- |
| Default reading | The parashah is the default; allow whatever verse selection is wanted. | Start from the whole portion. Support a continuous passage or separated groups without an artificial 7–15 verse cap. That range describes Daniel's usual selection. |
| Selection from Claude | Open the selected verses directly in Study. | A preparation link names the exact selection and lens. The whole portion stays easy to reach. |
| Exploration in the app | People must also be able to explore naturally in the app itself. | Finding a reading, following commentary, choosing verses, and preparing them must work without a Claude session. |
| Frequency | Custom readings are common; custom study guides are rare and mainly for studying with a rabbi. | Reading selection and ordinary source exploration lead the milestone. Occasional curation must not become the default route through the portion. |
| Alternative selections | Daniel rejected the interview's abstract distinction among candidates and saved readings. | Do not add a candidate-management workflow. Make choosing and revising verses straightforward. |
| Preparation order | Meaning, word understanding, and commentary precede trope for Daniel; hearing remains the default word action in Lein. | Study taps open meaning; Lein taps retain hearing. These defaults follow the selected activity. |
| Commentary | Use the original commentators themselves, curated at times to illuminate conversations in the tradition. | Display attributed source passages and their translations. A source catalog alone does not complete this task. |
| Library | Sources basically come from Sefaria; people do not need substantial personal collection management. | Reuse Sefaria references, editions, and source readers. Do not build a new personal source-library workflow. |
| Location of occasional discussions | Both beside relevant verses and in a list of the portion's main questions when curated material exists. | The two entrances open the same sources. Do not make a question list a mandatory stage or invent questions for every portion. |
| Curation | Daniel names a theme or question; Claude suggests sources for them to work through. Daniel suggested MCP as a possible home for this rare workflow. | Recommend authoring from the rabbi's conversation through MCP. The reader displays the resulting material where relevant, with no normal-app guide builder. |
| Introductions | “No intros provided at all.” | Curated discussions contain a question/title, source identities, and original source passages. They require no introductory essay, connecting explanation, or generated synthesis. |
| Audience | Everyone. | Curated source discussions are available on the public Study experience; they are distinct from private personal preparation. |
| Publication | Yes: telling Claude to add the discussion means publishing it. | Do not introduce a routine second publish step. Preserve truthful author, translator, and review attribution. |
| Commentary language | English only. An important untranslated source can be translated with Claude and added through MCP. | Use available English editions. Support adding a clearly credited Claude translation attached to the original source reference. The Torah text keeps its Hebrew-and-English reading view. |
| Personal thinking and writing | Claude only. | Remove new app notebooks, teaching-draft workflows, and translation-drafting proposals from this milestone. |
| Existing personal writing tools | “Cut.” | Remove the member reader's My notes and My translation controls from its normal interface. Preserve already saved work. Their links from other personal-reader surfaces must remain understandable. |
| Claude access | Claude should be able to access all of Daniel's preparation, without adding unnecessary kinds of preparation data. | Plan an owner-authorized connection to the preparation that actually exists. Staff status does not grant access to other people's private work. |
| Printing | Optional selected commentary goes “at the end.” | Preserve the bilingual reading sheet and offer a source appendix after the reading. Personal-note printing is no longer a requirement for this milestone. |
| Existing generated guides | Keep them secondary; custom study experiences are rare. Original sources are the main experience. | Make existing guides available when provided, through a secondary entrance. They do not define the ordinary reader's structure. |
| Order | Friday preparation follows Claude's current commitments. | Reconcile the plan against the active branches before implementation; do not interrupt or duplicate them. |

One optional interview question about initial source density was unanswered. The recommendation is a short, useful selection of original passages with additional discovery available. This is a display recommendation, not a confirmed source-count limit or permission to replace passages with summaries.

## The intended preparation journey

1. **Start in the app or Claude.** The app opens the whole portion and supports independent reading and exploration. Daniel can instead begin in Claude on Friday, explore themes, and bring a selection into the app. Neither entrance requires a custom study guide.
2. **Choose a reading.** Daniel can choose verses in Claude or while reading the portion in the app. Both routes lead to the same reading surface. Selecting verses must not require naming or organizing a collection.
3. **Study in context.** A direct selection link opens those verses in Study. Whole portion and selected verses are immediately available; the selection is recognizable within the whole. The current chapter and verse stay clear.
4. **Understand each word.** A word opens meaning and useful grammatical information near the verse. Audio is an explicit action in Study. Closing the word view returns to the same place.
5. **Explore original commentary.** Read default commentaries, follow a verse into related commentary, midrash, or other sources, and open a source in full without losing the passage. When a rabbi has added a curated discussion, it can also be opened from its question list or relevant verses. Commentary appears in English, with attribution and original-context links.
6. **Revise the reading.** Daniel can change its boundaries or include separated groups while keeping useful source context. The app confirms exactly which verses are selected.
7. **Prepare the chanting.** Switching to Lein preserves the selection and provides the existing listening, colors, tikkun, and practice tools. Hearing is the default word action in Lein; the same word opens meaning in Study.
8. **Print.** The current selection opens in the existing print-sheet feature. Optional selected source passages follow the bilingual Torah reading as an appendix. Private saved work is included only through a future, explicit user choice; this milestone needs no personal-note appendix.

## Feature gaps and responses

| Priority | Current capability and evidence | Gap | Recommended response and acceptance |
| --- | --- | --- | --- |
| First | The reading chooser supports named readings and book/chapter/verse selectors. | Selection is separate from discovery while reading. | Add selection from the displayed text, with an equivalent keyboard path and precise reference controls. A reader can choose, inspect, adjust, and open the intended verses without retyping references. |
| First | Saved readings exist; their update interface changes name and date. | Revising verses and returning to their full-portion context lack a coherent ordinary journey. | Treat whole-portion context and the selected reading as related views. Changing a selection produces a clear result and preserves existing work rather than silently discarding it. |
| First | Current MCP tools focus on staff/student work and guides. The print branch adds a read-only print link. | Personal reading preparation through Claude is not an established owner workflow. | First define the minimum handoff and owner authority needed for selecting, reopening, and revising a reading. A read/print link alone must not be described as creating a saved personal preparation. |
| First | Public word taps currently select and play a verse when listening is enabled. Word tools is a separate disclosure after the text. | Study makes immediate word understanding harder than necessary. | A Study word tap opens meaning in context without starting audio. Previous/next word remains available. Grammar has a clear route, and pronunciation tools remain accessible. |
| First | The source shelf provides many related works and categories; inline commentary supports registered works. | Ordinary exploration needs clearer routes from verse to source, deeper context, and back to the reading. | Reuse the source reader and improve selection-following, understandable source choices, full-text expansion, and return to place. A person can explore and choose verses entirely in the app without a guide or Claude. |
| Occasional follow-up | Existing guide bodies expect overview/intro/note prose with source attachments. | Rare source-only curation is not expressed directly by that model. | Adapt the contract when implementing the occasional MCP curation workflow. Support a question/title with ordered original-source references and optional translated-source records, without required prose. Display a question list only where curated material exists. |
| Occasional follow-up | English editions and attribution exist for supported works. | Adding a Claude translation as a translated source is different from writing a guide summary. | Bind a translation to the exact original reference and identify Claude as translator. Adding it through the authorized conversation publishes it without inventing an existing Sefaria edition. Translation is performed in Claude; this plan adds no server-side model subscription. |
| First | Member writing fields and links are already present. | They occupy an app experience Daniel wants focused on reading and sources. | Remove the normal personal writing interface and repair its entry links. Preserve stored work and keep it within the person's own authority. Tutor-assigned student exercises are not automatically removed by this member-reader decision. |
| Next | Long portions render many verse rows and commentary controls, with text-page navigation at the bottom. | Readers lack efficient orientation and return-to-place behavior at portion scale. | Add chapter/section navigation, a clear current reference, and dependable return from words and sources. Preserve position when switching lenses or whole/selected views. |
| Next | The print-sheet branch already has bilingual layouts, portion choices, formats, and an MCP print link. | Curated-source appendix and complete selection continuity are follow-ups to that work. | Extend the existing feature after integration. Print exactly the chosen reading, then optionally the selected sources, with readable page breaks and attribution. |

## UI and UX recommendations

### Reading and selection

Keep the reading itself central. Selection should work on a phone without relying on dragging small Hebrew characters; an explicit start/end or verse-selection action is a design candidate. Preserve the ordinary book/chapter/verse controls for exact entry and keyboard use. Choosing separated groups should be possible without creating a second management screen.

Use a clear switch between the whole portion and selected verses. In the whole portion, identify the selected verses without competing with the Hebrew or trope highlighting. The details of that visual treatment require a bounded design pass within the approved Annotated score direction.

The current selected reading should be named near its actions. Moving from Study to Lein or Print must carry that same selection. A long reading needs chapter labels and a way to jump, rather than requiring readers to find their place through scrolling alone.

### Word understanding

Study should show a word's meaning promptly and close to its verse. Keep the selected word and reference visible, with a clear close/return action. Let the reader advance word by word. Use a nearby panel on wide screens and a contextual sheet or inline panel on phones; choose the final composition through one design pass.

Keep audio under explicit listening controls in Study. In Lein, hearing remains the default word action. Recommend turning trope colors off initially in Study while retaining the toggle and existing Lein behavior. The color default is a consultant recommendation; the mode-specific word actions are confirmed.

### Original sources and curated discussions

Use plain question headings and author/work names to organize a discussion. The primary content is the selected original passage in English. Keep the reference, edition/translator credit, and route to its original context clear. A shortened passage must be recognizable as an excerpt, with expansion to its fuller context; do not present an AI paraphrase as the source.

Ordinary exploration is the common case: select a verse, see the relevant commentators and related texts, open a source, follow it further if useful, and return to the same passage. This must work before any specially curated material has been added.

When curated discussions exist, their question list gives an additional entrance. Opening a question identifies its relevant verses. Opening it from a verse presents the same sources and preserves the reader's place. A source that concerns several verses should not appear as several unrelated copies to manage. The app needs no question-authoring or guide-editing interface for this occasional workflow; MCP provides authoring.

Keep broader Sefaria discovery available after the curated selection. Related-source metadata establishes a connection, not necessarily agreement or disagreement; any asserted relationship between authors needs grounding in the passages themselves.

### Personal work and access

Keep Claude as Daniel's thinking and writing environment. Remove personal-reader writing controls and their misleading entry links, including any drill link that would lead to a removed personal writing field. Existing saved work remains owned by its author.

The current saved-data boundary intentionally excludes staff/MCP services. Supporting Daniel's requested access requires a reviewed owner-authorized contract, rather than treating an administrative connection as authority over all members' preparations. Its scope should cover the existing preparation data the person requests; do not create extra note or draft types merely to populate the connection.

Publication of curated source material is a different action from access to private preparation. Telling Claude to add a curated discussion publishes it for everyone. Private preparation does not become public through that publication action. Preserve accurate translator and review labels without introducing another routine publication confirmation.

### Printing

Use the active print-sheet feature. Preserve its bilingual reading, formatting controls, and attribution. Commentary is an optional appendix after the reading, grouped by the selected question/discussion and identifying the related verses. That grouping is a recommendation; Daniel confirmed the appendix's position, not a detailed page layout.

The default print path should remain brief. Additional options belong behind clear disclosures. Check longer source passages, page breaks, repeated credits, larger type, and paper formats in the actual print preview; a screen layout alone does not establish usable output.

### Accessibility and different audiences

Provide a practical keyboard route through a long passage, its verses, and its tools. The sampled 100-verse mobile page exposed more than 2,000 potentially focusable elements; that is an interaction-density signal, not a measured screen-reader failure. Check keyboard focus, Hebrew/English reading order, source-panel return, text enlargement, and phone touch selection explicitly.

The ordinary congregant should understand how to open and study the coming portion and save a reading without identifying as a Beit Mitzvah student. Keep the existing student, family, and tutor practice journeys recognizable. Their role-specific defaults can use the same text and source tools without adding their administrative controls to the public reading.

## UI reference findings

Sefaria's live [Genesis reader with Rashi](https://www.sefaria.org/Genesis.12?lang=bi&with=Rashi) was inspected for selecting a verse, changing the commentary context, opening the Resources panel, and keeping the passage visible beside its sources. Borrow the relationship between selected verse and neighboring source panel, a clear route through source categories, and recognizable chapter/reference context. Adapt those interactions to CRC Torah's English commentary, learning modes, and existing Annotated score direction.

The live [haftarah reader](https://haftarah.centralreform.org/2026-10-17-noach) and the read-only repository `C:/Users/dsbog/haftarah` at `33c04bc` were inspected. Useful patterns are:

- A Hebrew word opens a nearby panel with a plain-language explanation of its role and meaning before deeper dictionary material.
- A source name opens its full text, with the citation visible, while the reading stays in place.
- The reader has verse-linked commentary and a route to everything related to the verse.
- Closing a panel restores focus to its opener; `site/app/a11y.js` already demonstrates one Tab stop per word group with arrow-key movement.

The relevant local reference files are `site/app/sheet.js`, `panel.js`, `sefaria.js`, `words.js`, `a11y.js`, and `site/web.css`. These are UI inspiration and reusable reasoning; this consultation changes nothing in the haftarah repo. Its introductory essays, bilingual commentary panel, and sheet-specific content workflow are separate from the current CRC Torah decisions. Reference-site interaction was inspected on desktop; their mobile behavior was not freshly exercised in this pass.

## Recommended milestones

| Milestone | Outcome | Completion evidence |
| --- | --- | --- |
| Reconcile active work | The next assignment uses Claude's integrated print and learning work. | Check the then-current source and plans once. Record which recommendations are already satisfied. Keep the existing agreed roadmap and release gates. |
| Complete the reading journey | Independent in-app exploration, common custom readings, Claude handoff, direct verse selection, whole-portion context, and reliable selection persistence work together. | Complete one preparation entirely in the app and one from Claude. The same selection survives Study, Lein, reopening, and Print. Owner access changes receive the standing independent review. |
| Improve everyday study and practice | Original commentary is easy to explore; word actions match Study and Lein. | From a verse, open a source in full, explore related material, and return to place. A Study word opens meaning; a Lein word hears the reading. The whole journey works with no custom guide. |
| Simplify personal surfaces | Personal writing tools leave the normal reader; useful saved preparation remains reachable with the owner's authority. | No visible action leads to a removed field. Existing work is preserved and no other person's private work becomes reachable. |
| Finish output and integrated use | The bilingual reading can be printed with an optional source appendix. | Daniel checks the selected verses, source order, readability, attribution, page breaks, and a representative physical print. Congregant and Beit Mitzvah paths retain their separate purposes. |
| Support occasional guided study | A rabbi can add source-only curated material through MCP for a particular study experience. | Add a discussion with multiple sources and a source spanning verses. Both optional entrances show the same references; a Claude translation is distinctly credited when included. Existing guides remain secondary. |

These milestones specify outcomes and dependencies, not deadlines or a direction to interrupt current coding. Fix the observed saving/recovery concern before changing the member writing surfaces so stored work is preserved throughout the transition.

## Acceptance scenarios

1. **A Friday handoff.** In Claude, Daniel chooses a real passage from the coming portion. The app opens exactly those verses in Study. He can see the whole portion and return without rebuilding the selection.
2. **Selection during reading.** Starting with the whole portion, Daniel selects verses, includes a separated group, changes his mind, and sees the exact final count and references. An ordinary reader can perform the continuous-selection case without coaching.
3. **Understanding and hearing a word.** A Study word tap shows meaning without starting audio or forcing a trip to the end of the portion. In Lein, hearing is the default action. Next word and return to verse work on phone and keyboard.
4. **Ordinary exploration and occasional curation.** With no custom guide, a person can read the portion, browse original commentary, open a source in full, return, and select a reading entirely in the app. Separately, a rabbi can name a question to Claude, select sources, and say to add the discussion through MCP. Everyone can open the resulting occasional material from its question list and verses, without a required introductory essay.
5. **An untranslated source.** Claude supplies an English translation for an important source and adds it through MCP. Its reference and translator attribution are accurate, and the English source presentation follows the confirmed rule.
6. **Revision and privacy.** Changing the reading does not erase previously saved work. Claude's preparation access acts only for the authorizing person. Publishing sources exposes no private preparation.
7. **Existing guides.** The main Study path reaches original sources directly. Existing generated student guides are available secondarily without becoming the required entrance to the portion.
8. **Printing.** Print opens the current selection in the integrated print feature. Selecting commentary appends it after the bilingual reading. Leaving commentary off produces the reading sheet alone.
9. **Long passage orientation.** A reader moves across a chapter boundary, opens a source, returns to the verse, changes lenses, and keeps a recognizable location. Repeat with larger text and keyboard navigation.

## Research and evidence

The source review used main `e63a661` in `C:/Users/dsbog/bneimitzvah-study`. During consultation, the remote-tracking main advanced to `fa32d86` for personal offline reading packs; no changes appeared in the reviewed reader, saved-reader, or MCP paths in that comparison. Print work was inspected on `claude/print-sheet`, initially `391ccfa`, later `db433ab` after its merge of remote main. These are consultation checkpoints, not claims about the eventual integrated release.

Relevant repository evidence at the reviewed baseline:

- `src/components/portal/public-reading/reading-chooser.tsx` and `view.tsx`: selectors, reading navigation, Study/Lein, word/audio interaction, and page-level tools.
- `src/components/portal/saved/saved-reading.tsx`, `api.ts`, and `yours.tsx`: name/date editing, personal writing fields, and source-observed draft replacement on conflicting saves.
- `src/components/portal/workspace/study/study-rows.tsx`, `verse-panel.tsx`, `shelf-view.tsx`, and `word-tools.tsx`: source and word display, responsive panels, and context behavior.
- `src/server/study-guides/validation.ts`: prose-oriented guide structure with required theme introductions and verse notes.
- `src/server/mcp/instructions.ts`, `src/server/saved/access.ts`, and `tests/saved-structure.test.mjs`: current staff MCP and private owner boundaries. These require an explicit new contract for owner-authorized preparation access.
- The active print branch's `docs/superpowers/specs/2026-10-23-reader-print-sheet-design.md` and `src/server/mcp/print-tools.ts`: existing print implementation and the read-only MCP link.

Public browser inspection covered the coming portion's Study reader, word tools, original-source shelf, chooser, commentary menu, and desktop/390-pixel layouts. Authenticated member and family journeys were source-reviewed, not freshly exercised with real accounts. Physical printing, actual iPhone/Safari, and a full assistive-technology walkthrough remain acceptance work. A narrow mechanical scan of four reader components returned no findings; that does not establish overall usability or accessibility.

Sefaria's official [Texts v3 documentation](https://developers.sefaria.org/reference/get-v3-texts) describes reference-, language-, and edition-specific retrieval, missing-version reporting, and text-format controls. Its [Related documentation](https://developers.sefaria.org/reference/get-related) and [Links documentation](https://developers.sefaria.org/reference/get-links) describe connected-source metadata. They support reusing Sefaria as the library; the recommendation to organize sources around a question is an editorial/product inference. Source attribution and the project's existing content rules continue to apply.

## Return point

Daniel has confirmed the mission, narrowed the feature set, and answered the alignment questions that materially change the plan. Initial source density, exact selection gestures, appendix grouping, and detailed panel composition remain routine design recommendations above. None requires another broad mission interview.

The next useful action is to give the active implementation owner this plan after current commitments, reconcile against integrated source, and prepare a bounded design for common custom readings and independent in-app study. Sefaria and the haftarah reader supply concrete interaction references. Occasional MCP-authored guides follow the ordinary experience in priority. This consultation has not changed application code, existing mission files, active implementation plans, branches, deployments, or external application content.
