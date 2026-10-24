# 1.8 web siddur integration

**Settled decisions (Daniel, binding).**
- 1.8 is the integration only: "web siddur integration into 1.x". The service course stays in 2.0.
- Wording, 2026-10-24 popups:
  - each part: "Open in the siddur, page {page}" (it also replaces the live "Open in Siddur");
  - the top of the Service parts tab: "Your whole service in the siddur, from page {page}";
  - public /read: "Torah blessings: siddur page 22" and "Haftarah blessings: siddur pages 23–24", shown only for CRC. Daniel: "Yes (Recommended)".

## What exists

- **The siddur.** https://siddur.centralreform.org/ is a static reader (repo `shirei-tshuvah-web`) fed by `shireishabbat`. Both repos are read-only to us, and their rules win there. It honours `?book=<slug>&p=<printed page>`, which its own `tests/link.spec.js` guards.
- **The Beit Mitzvah volume** (`legacy-beit-mitzvah`): Shabbat morning on pages 1–31; Shabbat evening with Havdalah on pages 33–63.
- **Its licence.** It is used by permission for CRC's non-commercial use and is not licensed for anyone else. Nothing from it enters this repo.
- **The portal already has:**
  - the pinned service catalog (migration 0015, live), which holds each part's printed page;
  - tutor-assigned "Approved prayer text" in Service parts;
  - an "Open in Siddur" link in `my-service.tsx`, whose address is typed into the code;
  - the per-congregation `siddurUrl` setting.

## Approach

Link into the live siddur at the printed page; don't embed it or copy it.
- No text enters the repo.
- The siddur keeps its own offline copy.
- Links are built from the congregation's `siddurUrl`, so a second congregation (2.5) changes only its setting.

## Milestones (no production migration)

1. **M1 (Sonnet), link helper; the app first learns to accept the new fields.**
   - `src/lib/siddur/link.ts` `siddurPageLink(siddurUrl, book, page)`: it builds a link only for the recognised reader and a whole page from 1 to 9999.
   - `my-service.tsx` uses it.
   - `service-learning/api.ts` accepts an optional `page` and `serviceStart`.
   - Tests: `tests/app/siddur-link.test.ts`.
   - Deploy before M2, because the strict response checks reject unknown fields.
2. **M2 (Opus, with a second-agent review), server fields.**
   - `service-learning/service.ts`: `summary()` adds `page`, and `metadata()` adds `serviceStart`.
   - Tests: `service-learning.test.ts` and `service-learning-adversarial.test.ts` (no page across students or tenants).
3. **M3 (Sonnet), the visible links.**
   - `panel.tsx`: a link on each part and the whole-service link at the top.
   - `my-service.tsx`: the new wording.
   - Tests: `service-learning-ui.test.ts`.
4. **M4 (Sonnet), the /read blessings links.** For CRC only (the recognised `siddurUrl`).

## Acceptance

- CI is green and never-in-repo is green.
- The address siddur.centralreform.org appears in code only in `settings/validation.ts` and the tests.
- Open the live links by hand and record what each page shows: Sh'ma (10), V'ahavta (11), Torah blessing (22), Havdalah wine (60), and both service starts (1 and 33).
- Where a page holds several prayers, the link lands on the page's first prayer; list the affected parts.

## Open items that wait on Daniel

- **Licence, 2.5:** another congregation gets no CRC catalog text, no CRC siddur by default, and no links into this book. Ask when 2.5 starts.
- **Licence:** keeping assigned parts' text offline in the installed portal is not in 1.8, and would need his ruling if it were ever wanted.
