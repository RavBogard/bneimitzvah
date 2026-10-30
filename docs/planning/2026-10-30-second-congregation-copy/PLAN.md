# A congregation can run its own copy: plan

Started 2026-10-30. Rabbi Paul Kipnes wants his own copy of the app for his congregation. He is a novice-to-medium user and will be guided by Claude Cowork from a starter prompt. The prompt is sent only after the four pieces below are merged and deployed.

## Daniel's rulings (2026-10-30, 20 questions, binding)

1. **Separate copy he runs:** his own GitHub fork, Vercel, Neon and accounts. This is not a second tenant on CRC's site.
2. His congregation owns and pays for his accounts.
3. Whether his fork keeps syncing Daniel's releases is **his choice**. The prompt explains the trade-off.
4. The prompt sends him to Daniel only for real gates.
5. Tooling: Cowork decides what it can do itself and falls back to the Code tab of the Claude desktop app for commands.
6. His copy includes readings and study, students and tutors, and parents and honors. The MCP connector is left out at first.
7. Whether his app credits CRC and Daniel is his choice.
8. He can use any product name, "Beit Mitzvah" included.
9. **Binder/Avery tables:** Daniel's permission covers non-commercial use by other congregations. He doesn't need to ask.
10. **Reference audio:** publish the timing catalog openly as a **GitHub Release file** (not in the tracked tree; the never-in-repo guard stays unchanged). The source is the PocketTorah archive.org audio, CC BY-SA 3.0 ("PocketTorah (not-a-box media lab), CC BY-SA 3.0", per `C:/private/pockettorah/PROVENANCE.md`). The derived catalog goes out under CC BY-SA with that credit.
11. **Guides:** add an **export/import feature** to the product. Exports carry only **reviewed** guides and summaries, credited to their author ("From Rabbi Daniel Bogard"). The importing rabbi can edit or hide them. No student-specific content.
12. Planning docs stay as history; **DEPLOYING.md** is written for forks, committed to main before the prompt goes out.
13. **Rebrand by settings:** the congregation's name, canonical address, aliases and logo come from settings, so a fork needs no code edits and Daniel's updates merge cleanly.
14. Sign-in: he chooses between Google only and Google plus email link, with the trade-off explained.

## Decided here

- The CRC identity (name, centralreform.org addresses, Siona Benjamin floor logo) appears **only on CRC's own origins**. Anywhere else the identity comes from settings and falls back to a generic "Beit Mitzvah" with **no logo**. Siona's permission is CRC's alone, so a fork that forgets its settings must never show her art.
- CRC's production needs no environment changes: CRC's defaults apply on CRC's origins.
- A fork's web addresses enter the database through an operator script, not new migrations, because migrations can't know a fork's domain.
- The internal tenant id stays `crc` in forks. It is an internal label and never shown. Renaming it would touch reviewed security migrations.
- Imported guides arrive **held** (not student-visible) until the importing rabbi publishes them. Precedent: drafts saved over reviewed work are held.
- Migration numbers reserved: **0055** for D (guide import provenance) and **0056** for A, if needed.

## Slices

| Slice | What | Builder | Review |
|---|---|---|---|
| A | Identity settings + host operator script | Sonnet | Opus adversarial (auth origins) |
| C | Reference audio kit: Release assets + fork install script | Opus | lead |
| D | Guide export/import (reviewed only, credited, held on import) | Sonnet | Opus adversarial (tenant isolation, data access) |
| B | DEPLOYING.md for forks, after A and C | lead | — |
| — | Rewrite Kipnes's Cowork prompt against the finished setup | lead | — |

## Status

- 2026-10-30: plan written; A, C and D dispatched.
