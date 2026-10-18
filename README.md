# CRC B'nei Mitzvah

A web portal for child and adult Beit Mitzvah students at Central Reform Congregation, St. Louis. Students prepare their assigned Torah, haftarah and service readings with Hebrew text, translation, existing reference recordings and verse-specific study tools. The primary practice flow is direct word/verse playback in a continuous Hebrew passage.

Tutors and rabbis manage assigned readings, sources and notes. Parents can use their own account and explicitly open a linked child's practice view. Every record belongs to a congregation. The current release serves CRC; adding another congregation remains a separate gate.

Generated voices are outside1.0, and student recordings are parked. The retained trope engine computes chant scores from the te'amim using published melody tables. Its history-preserving move from the `trope-engine-research` branch of [RavBogard/haftarah](https://github.com/RavBogard/haftarah) preserves its research history and standalone tests. Daniel confirmed noncommercial use and public repository inclusion of the Binder/Avery tables; [the provenance note](trope/PROVENANCE.md) records the separate code, table and fixture terms. Future generated chant remains subject to its listening gates.

## Status

The portal is deployed at [beitmitzvah.centralreform.org](https://beitmitzvah.centralreform.org). Authentication, roster/access management, assigned reading, practice and study features are being delivered in reviewed checkpoints. Revised1.0 is still in progress; [STATE.md](docs/planning/2026-10-15-kickoff/STATE.md) records the exact production commit, pending gates and next work. Reference playback remains administrator-only until Daniel accepts actual-source word-tap and tab-return behavior. Automated synthetic checks do not replace that listening/phone acceptance.

## Run it

Node 24 LTS and npm. Dependencies are pinned exactly in `package-lock.json`.

```
npm ci
cp .env.example .env.local      # fill in locally; never commit
npm run dev
npm test                        # engine, policy/isolation and app (Vitest), no network
node --test "tests/trope-*.test.mjs" # engine only; no npm dependencies required
npm run typecheck
npm run build
npx playwright install chromium # one-time browser download for local checks
npm run test:e2e                # Playwright
```

`npm test` runs engine, policy/isolation and application tests against offline fixtures and PGlite. CI also checks Windows/Linux builds, native PostgreSQL authority and actual HTTP/browser behavior. Use the existing isolated test harnesses for subprocesses; they do not inherit application credentials. Production schema changes use reviewed release operators and their recorded fingerprints, rather than replaying development migration commands.

## Never in this repo

This repository is intended to be public. JPS or any other licensed translation, student or family data, recordings, rendered audio, model weights and credentials never enter it. Text is fetched from Sefaria at runtime under the reviewed provenance and storage rules. `tests/never-in-repo.test.mjs` checks tracked content, staged blobs and untracked publish candidates, including ignored files if force-staged. Local ignored files, including `.local-data/`, are outside the publish set and must never be committed.

The guard detects prohibited filenames, known credential formats, non-synthetic email addresses and publisher/version markers in data files. These heuristics cannot prove a text's licence or identify every piece of personal data. New fixtures still require review and provenance; the synthetic portal fixture path is not permission to commit real student information. Failures report filenames and reasons without printing matching content.

## Credits

- Texts and links: [Sefaria](https://www.sefaria.org). Hebrew: Miqra according to the Masorah (CC BY-SA). English: THE JPS TANAKH: Gender-Sensitive Edition (JPS, 2023, CC BY-NC) and the other editions as credited on the page.
- Calendar and readings: [Hebcal](https://www.hebcal.com) (CC BY 4.0).
- Word analysis: STEPBible TAHOT and TBESH, data created by www.STEPBible.org based on work at Tyndale House Cambridge (CC BY 4.0); Open Scriptures Hebrew Bible morphology (CC BY 4.0); Westminster Leningrad Codex (public domain).
- Melody tables: transcribed to scale degrees from the Binder/Avery tables (Standard Reform) and from Idelsohn, *Thesaurus of Hebrew Oriental Melodies* (Moroccan); each table and cell cites its source.
- Syllables: [havarotjs](https://github.com/charlesLoder/havarotjs) by Charles Loder (MIT), vendored in `trope/vendor/havarotjs/`.
- Fonts: Ezra SIL, Noto Serif Hebrew, Literata (SIL Open Font License).

## Licence

Code: MIT (`LICENSE`). Binder/Avery tables (`trope/cells/haftarah.json` and `torah.json`): permission for noncommercial use and public repository inclusion, reported and expressly confirmed by Daniel on 2026-10-15; this does not grant unrestricted commercial use or sublicensing. See [table permissions](trope/cells/README.md). MAM fixture Hebrew and adaptations: CC BY-SA 4.0; Hebcal fixtures: CC BY 4.0, with [attribution and modification notices](tests/fixtures/trope/NOTICE.md). SoulX and havarotjs retain their Apache-2.0 and MIT notices. Each material keeps its own terms.
