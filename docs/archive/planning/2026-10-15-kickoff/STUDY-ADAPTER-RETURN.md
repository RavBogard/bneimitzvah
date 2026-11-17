# Bounded study-text adapter — 2026-10-16

Scope: `src/server/study/{types,versions,normalize,sefaria}.ts`, two synthetic
`tests/app/study-*.test.ts` files, exact parser dependency and this plan/return.
No routes, runtime composition, cache/schema, Git operations, provider setup or
haftarah writes. Caller authorization and final live authority/assignment
revalidation remain mandatory future composition gates, not behavior supplied
by this standalone public-text adapter.

The four modules provide a closed MAM/JPS 2023 edition registry and credits,
canonical page planning against trusted chapter counts and exact assignment
verse rows, bounded chapter fetching, and non-executing HTML-to-structured-text
normalization. Pages contain at most 100 assigned verses/eight chapters. Requests
use only exact HTTPS Sefaria v3 chapter URLs, two concurrent fetches, five-second
request/eight-second page deadlines, 512 KiB streamed chapter/2 MiB aggregate
budgets, no redirects, cookies or incoming headers. These are accepted application
operating decisions, not upstream guarantees. Errors are fresh fixed messages
without provider bodies/causes. Returned provenance includes exact edition/source
and license links plus a direct Sefaria chapter link, timestamps and content hash.

Edition/language/license/source, canonical book/chapter/section shape and complete
chapter array counts must match. Only selected assigned rows leave the adapter.
Provider chapter-array order is trusted after structural validation; it has no
independent per-verse IDs and cannot prove the wording is correct. An explicitly
warned missing English edition yields unavailable; blank English segments yield
an explicit partial state. Wrong/mixed/malformed English fails, with no fallback.

parse5 **8.0.1** is exactly pinned after checking the
[official release](https://github.com/inikulin/parse5/releases/tag/v8.0.1) and
[parser options](https://parse5.js.org/interfaces/parse5.ParserOptions.html).
It does not execute scripts. Output contains plain strings and typed segments,
never provider HTML. MAM written/read alternatives, paragraph gaps and inverted
nun positions remain explicit; footnotes disappear, vowels/accents/CGJ and Hebrew
punctuation remain, with NFC normalization. Hostile tags/attributes, malformed
Unicode, direction overrides, malformed markup and unknown semantic classes deny.
One-sided alternatives, other MAM classes/poetry formatting and unseen structures
remain explicit coverage limitations requiring verification; no full-Tanakh
coverage or UI/chant semantic acceptance is claimed. No regex helper is promoted
as a sanitizer.

Authorized live probes used memory only: four minimal verse responses identified
known structure categories; one chapter confirmed flat 31-segment arrays and
string section numbers; a repeated qere check confirmed child order; two
missing-edition probes confirmed nested warning101.
The actual adapter then passed a private **2/2** contract gate: Genesis chapter1
projected only two selected rows with both exact reviewed editions; minimal MAM
qere/ketiv, inverted-nun and footnote examples normalized successfully. Output was
fixed test names, shapes/categories and counts, never passage text/raw JSON.
Ignored probe code/logs contain no fetched text. Existing engine fixtures were
not used as full-reading content or copied into new tests.
This adapter work made twelve public v3 requests total: two chapter-addressed
and ten segment-addressed, including the two missing-edition probes. It did not
check every chapter/book, edition coverage, variant MAM structure or availability.

Synthetic tests cover exact row/count/edition mapping, separate written/read
forms, marked Hebrew and paragraph semantics, hostile HTML/entities/controls,
unknown structures, page limits, reverse completion, missing English, byte limits,
fixed errors, fetch/body stalls ignoring abort, caller cancellation, cancellation
of a parallel reader after first failure and aggregate concurrent byte budgets.
A late response after an ignored deadline is canceled before acquiring a reader.
Final focused synthetic run: **51/51 passed**; typecheck passed; repository
publish-candidate/index guard **1/1 passed**. The late-response regression and
its cancellation check were the final relevant change after the earlier50/50
checkpoint. Private live contract gate **2/2 passed** before that cleanup-only
change; no repeat provider fetch was needed. npm install reported zero
vulnerabilities. Ignored evidence: `.local-logs/study-adapter-tests.log`,
`study-adapter-typecheck.log`, `study-adapter-repo-guard.log` and
`study-live-contract.log`. Primary source review accepted the adapter-only
scope; root retains integration/CI/publication gates and final review of the
last cancellation check.

Licenses remain separate from MIT code: MAM CC BY-SA4.0, JPS 2023 CC BY-NC4.0,
credited via Sefaria and the reviewed publisher/maintainer URLs in the plan.
Unknown changed provenance/editions fail closed. No licensed passage or translation
fixture was written to Git. Independent adapter review and future authority/cache
composition tests remain before any text endpoint or release.
