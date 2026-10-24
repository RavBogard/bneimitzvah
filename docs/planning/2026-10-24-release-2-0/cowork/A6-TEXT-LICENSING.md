# A6. Prayer text in the course: the licence question, decided

2026-10-24. Decided by Daniel in Batch 1 Q2 ("open") and Q3 ("Go"). Keys as in `notes/RULINGS-DIGEST.md`.

## Decision

- The service course is open to everyone, signed in or not.
- **Licensed Beit Mitzvah text (`legacy-beit-mitzvah`) is never shown in the app, never stored in the app repo, never cached offline by the app.** The course reaches it only by the 1.8 link: "Open in the siddur, page {page}" (SIDDUR L6–8, L23 "Link into the live siddur at the printed page; don't embed it or copy it").
- Prayer text the course does show comes from the public Shabbat Morning volume (`shabbat-shacharit`, CC BY-NC-SA 4.0) where the prayer matches (cross-walk in `A2-INVENTORY.md`), with the licence credit. [Inferred from "open": Daniel accepted the recommendation as written, which named this book.]
- Where no public text matches (CRC-original pages, Havdalah items not in the public volume, modern songs such as Miryam HaN'viah), the course shows teaching and the siddur link only.
- Sefaria liturgy is a fallback only for a prayer missing from both, shown live with edition, licence and credit.

## What each audience gets

| | Signed out | Signed in student | Offline (installed app) |
|---|---|---|---|
| Teaching (approved, credited "Rabbi Daniel Bogard") | yes | yes | yes |
| Public-volume Hebrew, transliteration on request | yes | yes | yes, under the 14-day rule |
| Licensed BM page | link only | link only | not available (the link needs a connection) |
| Their own assigned parts as a path | no | yes | yes |

## Things Claude Code must check

1. The public text and the BM page can differ by a line. Each lesson shows the siddur link beside the public text so the student sees what CRC prints. [Inferred risk: a student practises a line CRC doesn't print. Mitigation is the link plus the tutor.]
2. The Shabbat Morning volume is hidden from the reader's shelf (Daniel, 2026-09-04). Using its text in the course doesn't unhide it in the reader.
3. The app's service feed parser accepts only `legacy-beit-mitzvah` (A2). The course needs a separate read of the public volume's feed (`dist-app/shabbat-shacharit-feed.json`), by stable unit id, text only, never the licensed lane.
4. Second congregation (2.5): it brings its own volume and teaching or the course is off for it (RM2 Q22). Nothing in 2.0 hard-codes CRC's book into the course model beyond a per-tenant volume id.
5. Never-in-repo: course data files hold unit ids, page numbers and approved teaching only.
