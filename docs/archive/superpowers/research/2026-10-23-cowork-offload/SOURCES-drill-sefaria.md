# Sources: the translate drill and Sefaria as an upstream

All sources were consulted on 2026-10-23. Publication or update dates are given where the page shows them.

## The translate drill (`translate-drill.md`)

| Source | Date | Used for |
|---|---|---|
| Gershom Tave, "Building Tanakh Skills One Step at a Time With Manipulative Materials", *Jewish Educational Leadership* (Lookstein Center), https://lookstein.org/?p=270628 | 2025-01-07 | Scaffolds: roots, prefix and suffix cards, word-by-word verse work |
| *Biblical Hebrew Translation, Grammar and Meaning Workbook* (4th grade), hosted by Brandeis, https://www.brandeis.edu/scroll/translation-grammar-meaning-workbook.pdf | No date shown | Scaffolds: roots first, colour-coded affixes, bracketed added words |
| *Fundamentals of Court Interpretation: Sight Translation Exercises* (Agnese Haury Institute, 1991), Judicial Council of California, https://languageaccess.courts.ca.gov/system/files/2025-10/sightransexercises.pdf | Posted 2025-10 | Sight translation drills: reading ahead, chunking, reading aloud |
| Seabrooke, Mitchell, Wills, Inkster, Hollins et al., "The benefits of impossible tests: Assessing the role of error-correction in the pretesting effect", *Memory & Cognition* 50, https://link.springer.com/article/10.3758/s13421-021-01218-6 | Online 2021-08-06; issue 2022 | Guessing a translation, then seeing it, improves later memory, even when the guess is wrong |
| Anki manual, "Studying", https://docs.ankiweb.net/manual/studying | Current docs | The counter-model: reveal, then grade yourself (Again, Hard, Good, Easy) |
| Pimsleur, "The Pimsleur Method", https://www.pimsleur.com/the_pimsleur_method | Current page | Anticipation: prompt, pause, response, then reinforcement, with no grade |
| *A Reader's Hebrew Bible* (Brown and Smith, Zondervan), publisher's listing and reviews, https://www.thegospelcoalition.org/themelios/review/a-readers-hebrew-bible/ | Search results only; page not read | Rare-word glosses as a reading scaffold. Background only: the exact frequency threshold is not confirmed here. |
| Repo: `docs/superpowers/specs/2026-10-22-leyning-platform-design.md` §3.2–3.4; `docs/superpowers/plans/2026-10-22-accounts-1-4.md` §5 "Study (PR 3)"; `DESIGN.md`; `PRODUCT.md` | 2026-10-22 | The drill's spec and planned behaviour, and the tone and design rules |

## Sefaria as an upstream (`sefaria-upstream.md`, `../SEFARIA-NOTE.md`)

| Source | Date | Used for |
|---|---|---|
| Sefaria Terms of Use, https://www.sefaria.org/terms (the embedded Google Doc) | Last updated 2026-04-15 | Crawling ban (§3); no commercial use (§3); no abusive or burdensome automated use (§5); trademarks; attribution by hyperlink (§4) |
| Sefaria developers, "Copyright and Data Use", https://developers.sefaria.org/docs/usage-of-our-name-and-logo | Updated 2026-10-20 | Code under GPL-3.0; a licence per text version; links dataset under CC BY; name and logo trademarked; two open "Powered by" graphics |
| Sefaria developers, "Getting started", https://developers.sefaria.org/reference/getting-started | Current | No API keys needed; contact form |
| Sefaria developers, "Contact us", https://developers.sefaria.org/page/contact-us | Current | Engineering form; Sefaria's general-questions address; showcase form |
| Sefaria developers, "Projects Powered By Sefaria", https://developers.sefaria.org/docs/powered-by-sefaria | Updated 2026-10-20 | Submission form; the showcase |
| Sefaria developers, "Powered by Sefaria acceptance criteria", https://developers.sefaria.org/docs/powered-by-sefaria-acceptance-criteria | Updated 2026-10-12 | Listing is curated and at Sefaria's discretion |
| Sefaria developers newsletter, "Sefaria-Export, A Data Puzzle and Deep Wiki" (Issue 8), https://developers.sefaria.org/docs/sefaria-export-a-data-puzzle-and-deep-wiki | 2026-04-29 | Monthly bulk export in public GCS buckets; "please do" tell us |
| Sefaria, "Powered by", https://sefaria.org/powered-by | Current | "Tell us about it", Sefaria's developers address, listed projects |
| Sefaria developers, llms.txt index, https://developers.sefaria.org/llms.txt | Current | Confirms there is no page on rate limits or API best practice |
| Repo: `src/server/study/sefaria.ts` | main, read 2026-10-23 | Concurrency 2, coalescing, cache; no User-Agent sent |

**Not found:** any published Sefaria rate limit or caching guidance, either on the developer portal or in the Terms of Use, as of 2026-10-23.
