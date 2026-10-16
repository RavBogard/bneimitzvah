# CRC B'nei Mitzvah

A web portal for b'nei mitzvah students at Central Reform Congregation, St. Louis. A student signs in and finds their own Torah reading: the Hebrew with vowels and cantillation, a translation, the trope coloured by family, commentary their rabbi and tutor chose for them, and tools to work out their own translation word by word.

Tutors and rabbis see their students, assign sources, leave notes, and hear what students record. Parents get a read-only view. The portal is built for one congregation now and more later: every record belongs to a congregation from the schema up.

The planned trope engine will compute chant from the te'amim using published melody tables (Standard Reform, Binder/Avery, first). Its history-preserving move from the `trope-engine-research` branch of [RavBogard/haftarah](https://github.com/RavBogard/haftarah) is Phase 1; it is not present yet. No student hears generated chant until it passes a listening review.

## Status

Phase 0 local foundation: a technical Next.js placeholder, offline tests, repository safeguards and CI configuration. External repository publication, hosted CI and deployment are separate gates. See `docs/planning/2026-10-15-kickoff/STATE.md`.

## Run it

Node 24 LTS and npm. Dependencies are pinned exactly in `package-lock.json`.

```
npm ci
cp .env.example .env.local      # fill in locally; never commit
npm run dev
npm test                        # policy/isolation and app (Vitest), no network
npm run typecheck
npm run build
npx playwright install chromium # one-time browser download for local checks
npm run test:e2e                # Playwright
```

At Phase 0, `npm test` runs Node policy/isolation tests and a real offline PGlite database probe. Engine tests arrive in Phase 1. Database schema, Drizzle dependencies and `db:*` scripts arrive together in Phase 2; there are no placeholder migration commands.

## Never in this repo

This repository is intended to be public. JPS or any other licensed translation, student or family data, recordings, rendered audio, model weights and credentials never enter it. Texts will be fetched from Sefaria and cached in the database. `tests/never-in-repo.test.mjs` checks tracked content, staged blobs and untracked publish candidates, including ignored files if force-staged. Local ignored files are outside the publish set.

The guard detects prohibited filenames, known credential formats, non-synthetic email addresses and publisher/version markers in data files. These heuristics cannot prove a text's licence or identify every piece of personal data. New fixtures still require review and provenance; the synthetic portal fixture path is not permission to commit real student information. Failures report filenames and reasons without printing matching content.

## Credits

- Texts and links: [Sefaria](https://www.sefaria.org). Hebrew: Miqra according to the Masorah (CC BY-SA). English: THE JPS TANAKH: Gender-Sensitive Edition (JPS, 2023, CC BY-NC) and the other editions as credited on the page.
- Calendar and readings: [Hebcal](https://www.hebcal.com) (CC BY 4.0).
- Word analysis: STEPBible TAHOT and TBESH, data created by www.STEPBible.org based on work at Tyndale House Cambridge (CC BY 4.0); Open Scriptures Hebrew Bible morphology (CC BY 4.0); Westminster Leningrad Codex (public domain).
- Melody tables: transcribed to scale degrees from the Binder/Avery tables (Standard Reform) and from Idelsohn, *Thesaurus of Hebrew Oriental Melodies* (Moroccan); each table and cell cites its source.
- Syllables: [havarotjs](https://github.com/charlesLoder/havarotjs) by Charles Loder (MIT), vendored in `trope/vendor/havarotjs/`.
- Fonts: Ezra SIL, Noto Serif Hebrew, Literata (SIL Open Font License).

## Licence

Code: MIT (`LICENSE`). The licence for the melody tables in `trope/cells/` is not yet decided (engine open item 15). Texts and data keep their own licences above.
