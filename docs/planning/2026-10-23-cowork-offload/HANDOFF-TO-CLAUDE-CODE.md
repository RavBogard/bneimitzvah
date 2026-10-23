# Cowork to Claude Code: decisions and deliverables

Updated 2026-10-23. Daniel's answers in full, verbatim, are in `QUESTIONS.md`. Read it first.

## Done

- Batches A to F were all answered on 2026-10-23. E and F are the alignment questions the research raised. The listening round hasn't been run yet; its sheet is ready.
- Research: `research/pwa-offline.md`, `research/sign-in-codes.md`, `research/translate-drill.md`, `research/sefaria-upstream.md`, `research/learn-next-activities.md`; sources in `SOURCES.md` (and the per-report `research/SOURCES-*.md`).
- Drafts and sheets: `icons/` (four options; Daniel chose option 2), `LISTENING-ROUND.md`, `FORWARD-MESSAGE.md`, `PHONE-CHECK.md`, `TROPE-SONG-SESSION.md`, `ROADMAP-2.md`, `ANNOUNCEMENTS.md`. `SEFARIA-NOTE.md` is an unused draft (E3).

## Daniel's decisions, in the order to act

| # | Decision | Plan and section it changes | Act |
|---|---|---|---|
| A1 | Account emails kept as proposed | `plans/2026-10-22-accounts-1-4.md` §4 | Build as written |
| A2 | Request screen and approver strings kept as proposed | `plans/2026-10-22-accounts-1-4.md` §5 | Build as written |
| E1 | `productName` is a per-congregation setting | accounts plan §4–5; installable plan §3.8, §3.9, §10; every string naming "CRC Torah" | Make it a congregation setting now; strings use `{productName}`. CRC's value is "CRC Torah" |
| A3 | Sign-in email: 6 digits, 5 minutes, button "Email me a sign-in link"; five lines in `QUESTIONS.md` A3, with the new phishing line | installable plan §10, §2.8 item 5 | Update the template and test. Render the code alone on one line, the only 6-digit number in the email; no digits in the subject; no WebOTP `@host #code` line (`research/sign-in-codes.md`) |
| B4 | Install, iPhone, iPad, pill and expiry strings in `QUESTIONS.md` B4 | installable plan §3.9 | Replace the single iOS line with separate iPhone and iPad steps; the 14 days run from the last successful online open |
| B5 | Icon: option 2, the yad | installable plan §3.8 | Draw from `icons/ICON-OPTIONS.md` / `icons/option-2-yad.svg`; strokes no thinner than drawn |
| B6 | No parent offline view of a child in 1.5 | installable plan §3 | Keep it out |
| C9 | Daniel's device check is on Android (Chrome) | installable plan §6.4 | Use `PHONE-CHECK.md` |
| Extra | Azla vs geresh look-alike is reading-only | `research/learn-next-activities.md` | No listening version of that pair |
| E3 | No courtesy note to Sefaria | none | Still add the User-Agent and the CC BY credit (below) |
| F1 | Accounts are open to anyone who asks in good faith; approvers decline only spam or abuse | accounts plan §5 (approver page help text, if any) | No membership check; approver note in `ANNOUNCEMENTS.md` matches |
| F4 | Translate drill in Lein only; English hidden on every verse while it is on | accounts plan (1.4 part 3, "the selected verse's tools"); spec §3.4 | Build as planned, in Lein only; not in Study |
| F3 | Learn to lein works offline in the installed app, under the same 14-day rule | installable plan §3.3 (add a course pack), §3.4 | Add a public course pack (lessons JSON plus clips); account progress syncs when online |
| F2 | Index `/read`, `/learn` and `/trope-chart` at the 1.5 beta tag; everything signed-in stays noindex | MISSION "noindex until beta"; the 1.5 beta-tag step | Flip robots/meta for those three routes with the beta tag |
| D11, D-a | Second congregation: its rabbi first; day one is the public pages plus accounts, with the workspace later; one deployment, with each congregation on its own address, once the two-tenant isolation suite passes | MISSION ruling 21; `ROADMAP-2.md` | Plan for multi-host in one deployment |
| D-b | JPS 2023 may be shown for other congregations | MISSION licences | No JPS gate on a second tenant |
| D12, E2 | 2.0 builds no siddur. It integrates the existing web siddur (shirei-shabbat, with its Beit Mitzvah volume). It adds a service course in the Learn to lein pattern that also teaches about each prayer, using Daniel's own understanding from the shirei-shabbat and shirei-tfilah repos | MISSION "custom siddur ... v2.0"; `ROADMAP-2.md` | Replace "custom siddur and supplement" in 2.0 planning with this |
| D-5 | 2.5 audio: generated chant per trope system, each after its own blind review, with a recording by Daniel or a song leader as the fallback; blessings as text plus a CRC Music link | `ROADMAP-2.md` 2.5 | Plan as stated |

## Findings that touch the plans (not Daniel's calls; yours to settle)

From `research/pwa-offline.md`:
1. Since iOS 26, every Home Screen add opens as a web app. The worker registers only in standalone mode (§3.1), so if "Open as Web App" is off, the user has a bookmark, no worker, and WebKit's 7-day deletion applies. B4's steps say to keep it on.
2. One `persist()` call (§3.5) is weak. Check `persisted()` on every open and ask again when it is false.
3. Android's `beforeinstallprompt` fires only after a tap plus about 30 seconds, so add a menu fallback ("Install app").
4. iOS ignores maskable and manifest icons in favour of `apple-touch-icon`. Serve a static 180 px opaque `/apple-touch-icon.png`.
5. Since iOS 17.2, the login cookie is copied into the installed app, so §3.5's "separate from Safari" is only partly true.
6. Some families may already have a beitmitzvah Home Screen app. The cutover should tell them to delete it and add the new one.
7. Size: the plan's own table says 35–40 MB for a double parashah, so the string says "about 40 MB".

From `research/sign-in-codes.md`: whether Mail offers an emailed code to a Home Screen web app is undocumented. `PHONE-CHECK.md` tests it.

From `research/sefaria-upstream.md`:
- `src/server/study/sefaria.ts` sends no User-Agent. Suggested: `CRC-Torah/1.4 (+https://torah.centralreform.org)`.
- The links behind More on this verse are CC BY and need a credit line.
- Never pre-warm the cache by walking whole books.

From `research/translate-drill.md`:
- The drill is in spec §3.4, not §3.6.
- Daniel ruled Lein only (F4); ignore the report's suggestion to add it to Study.
- While the drill is on, hide the English on every verse and close inline Rashi.

From `research/learn-next-activities.md`:
- "Which half of the verse" should play from the verse start up to the phrase. This changes ACTIVITIES.md #12.
- Quick ten needs the validator's 8-item cap raised, and new activity types registered.

From `LISTENING-ROUND.md`: row 16 (kadma v'azla, haftarah) cuts gershayim alone while the bold line describes kadma v'azla. Check it before the round.

From `ROADMAP-2.md`:
- The two-tenant suite and the auth/isolation adversarial pass are still unticked.
- The app assumes one configured origin.
- Settings links are limited to CRC domains.
- Service slots are fixed to morning and Havdalah.
- Public pages are CDN-cached by path alone, so anything that varies by congregation could cross tenants.

## Still open

- The listening round with Daniel (about 10 minutes, `LISTENING-ROUND.md`). Its edit list comes after.
- `FORWARD-MESSAGE.md` waits for Daniel to fill in the helper's name and send it.
