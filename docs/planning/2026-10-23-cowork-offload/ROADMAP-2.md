# Roadmap draft: 2.0, 2.5 and the generated chant voice

Written by Cowork for Claude Code and Daniel (handoff §5.7). Planning only: no code, no dates. It gives shape and cost; Daniel sets the order and the timing.

**How to read the tags.**
- **[Ruled: source]** means Daniel decided it, and the source says where.
- **[Inferred]** means Cowork's reading of the code or the plans. It needs Daniel's answer or Claude Code's check before anyone builds on it.
- **[Ruled: QUESTIONS ...]** means Daniel answered it on 2026-10-23 in `QUESTIONS.md`: Batch D (D11, D-a, D-b, D12, D-5) or Batch E (E1, E2). All of these are folded in below.

Sources are cited by short name:
- **MISSION** is `docs/planning/2026-10-15-kickoff/MISSION.md`.
- **STATE** is `STATE.md` beside it.
- **REVIEW** is `docs/planning/2026-10-16-review/PLAN-REVIEW.md`. Ruling numbers come from its §1.
- **SPEC** is `docs/superpowers/specs/2026-10-22-leyning-platform-design.md`.
- **R1.5** is `docs/superpowers/research/2026-10-22-release-1-5-research.md`, "Daniel's rulings on this document".
- **VOICE** is `docs/superpowers/research/2026-10-22-voice/VOICE-BUILD-PLAN.md`.
- **EXP1** is `EXPERIMENT-1.md` beside it.
- **SETTINGS** is `docs/planning/2026-10-21-congregation-settings/DECIDED.md`.

---

## 1. Release 2.0

### 1.1 What 2.0 is, as already ruled

| Item | Status | Where it is ruled |
|---|---|---|
| Beta runs from 1.5 until 2.0; 2.0 is "out of beta" | [Ruled] | MISSION, 2026-10-22 amendment ("1.5 release will be beta. We will be in beta until 2.0"); SPEC §6 **[Superseded 2026-10-24: beta is Daniel's word alone; see MISSION.]** |
| Search-engine indexing turned on, if Daniel wants it | [Ruled as Daniel's choice] | SPEC §6 2.0 row; MISSION ("Public pages ask search engines not to index them until beta") |
| The notifications Daniel chooses. The code is live but switched off: `PORTAL_NOTIFICATIONS_ENABLED` is unset. It covers tutor draft notices, the weekly parent digest and student reminders | [Ruled: off until Daniel says] | SPEC §6; MISSION ("Notifications stay off until Daniel says to switch them on"); STATE, the PR #17 gate line |
| D'var Torah drafting and tutor feedback | [Ruled: 2.0] | R1.5 ruling 4 ("D'var Torah stays in 2.0", keeping study-guide spec S3); STATE, 2026-10-22 (1.5 planning); REVIEW ruling 30 and §6 |
| Siddur: 2.0 builds no custom siddur. It integrates the existing web siddur (shirei-shabbat repo, web-siddur, including its Beit Mitzvah volume) properly into the portal, and adds a service course in the Learn to lein pattern | [Ruled: QUESTIONS D12, E2] | Daniel, 2026-10-23: "We have the siddur available via shireishabbat repo/ web-siddur, already. Beit mitzvah siddur. Should have proper integration . Should have ways for students to learn the service". This replaces the earlier "custom siddur inputs, supplement generation and packet export" line (REVIEW ruling 44 and §6; MISSION, the Office line), which is no longer 2.0 scope |
| Family logistics from the binder | [Ruled: v2.0, in outline only] | REVIEW §6 ("anything from the binder's family logistics") |
| Other congregations come after 1.5 | [Ruled: after 1.5, not in it] | STATE, 1.5 rulings (2) ("other congregations ... come after 1.5"). Actual provisioning is Daniel's gate: MISSION rulings 21/52 |
| The second congregation: first contact is its rabbi; day one is the public pages plus accounts; the Beit Mitzvah workspace comes later | [Ruled: QUESTIONS D11] | Daniel, 2026-10-23 |
| One deployment serving several congregations, each by its own web address, once the two-tenant isolation suite passes | [Ruled: QUESTIONS D-a] | Daniel, 2026-10-23, "One deployment" |
| JPS 2023 may show on another congregation's pages under the existing arrangement; no JPS note needed | [Ruled: QUESTIONS D-b] | Daniel, 2026-10-23, "Yes, it's covered" |
| D'var Torah, the chosen notifications, indexing of public pages only, out of beta | [Ruled: QUESTIONS D12] | Not objected to when Daniel answered D12; they stand as drafted |
| The service course: a course in the Learn to lein pattern for the service. Each prayer also gets teaching about the prayer itself, drawn from Daniel's own commentary and framing in the shirei-shabbat and shirei-tfilah repos, not written fresh by Claude | [Ruled: QUESTIONS E2] | Daniel, 2026-10-23: "A course, that also teaches about the prayers, using my understanding for each, pulled from shireishabbat and shirei tfilah repos" |
| `productName` is a per-congregation setting (for example "{Congregation} Torah"); CRC's value is "CRC Torah"; CRC credit stays in the footer | [Ruled: QUESTIONS E1] | Daniel, 2026-10-23, "Their own name, set per congregation" |
| Generated chant arrives in 2.0 if the cantor-voice test falls short and nothing passes the blind review in 1.5 | [Ruled as a fallback] | STATE, 1.5 rulings (9) |
| "Anything the beta teaches us" | [Ruled, open-ended] | SPEC §6 |

[Inferred] Student recordings stay parked: they were dropped from 1.5 (R1.5 ruling 1) and nothing places them in 2.0. Leave them out unless Daniel reopens them.

### 1.2 The second congregation

**Decided** [Ruled: QUESTIONS D11, D-a, D-b]:
- First contact is the second congregation's rabbi.
- Day one is the public pages (Lein, Study, Learn to lein) plus accounts. The Beit Mitzvah workspace comes later.
- One deployment serves several congregations, each by its own web address, once the two-tenant isolation suite passes.
- JPS 2023 is covered for other congregations. No JPS question remains.

**Already built** (STATE, the PR #12 gate line; SETTINGS):
- `tenant_settings`, append-only and RLS-forced.
- An admin settings page.
- The owner-only `scripts/add-congregation.mjs`. It writes one tenant row, one host row and an empty first settings row, and sends no mail and creates no member.
- Approvers are built per congregation (STATE, 1.5 rulings (2)).

**Not yet done.** The Phase 2 checklist in STATE still shows these unticked:
- "adversarial pass (auth, isolation)";
- "Gate: role matrix, two-tenant suite".

#### a. What must be configurable per congregation

| Setting | Today | Needed |
|---|---|---|
| Name and product name (`tenant.name`, `tenant.product_name`) | Exist. CRC's product name is "CRC Torah" (migration 0035) | `productName` is a per-congregation setting, made a setting now; every string uses `{productName}` [Ruled: QUESTIONS E1]. See "Hard-coded CRC text" below |
| Host and origin (`tenant_host`) | The script writes the row. But "the runtime serves exactly one configured origin today" (SETTINGS, Open for Daniel; script header) | Multi-origin support in the one deployment [Ruled: QUESTIONS D-a]. This is the biggest single piece of work [Inferred] |
| Calendar (diaspora or Israel) | Script flag `--calendar` | Done |
| Rabbi display name | A settings field, wired to study guides | Done |
| Service names and times | A settings field, but only two fixed slots: `morning` and `havdalah` (`src/server/settings/validation.ts`, `SERVICE_SLOTS`) | Other congregations may hold Friday-evening or mincha services. Widen the slot list or make it per congregation [Inferred] |
| Preferred commentaries | A settings field (`preferredSources`) | Done |
| Siddur link, music link | Settings fields. But the URL check accepts **only** centralreform.live and centralreform.org hosts (`SETTINGS_URL` in `validation.ts`) | Allow each congregation's own hosts. Use a per-tenant allow-list, not an open URL field [Inferred] |
| The siddur link label | Reads "CRC digital siddur collection" for every congregation (SETTINGS, Open for Daniel) | Take it from the tenant |
| Roster Sheet | CRC's Sheet is set in the environment (`GOOGLE_ROSTER_SHEET_ID`). The settings field is stored but never read (SETTINGS) | Read the settings field for any congregation other than CRC |
| Consent notice | A settings field | Done |
| Notification switches and digest weekday | A settings field | Done; each switch is still subject to the global flag |
| Approvers | Built per congregation [Ruled: STATE 1.5 rulings (2)] | Done |
| Melody tradition | Standard Reform (Binder/Avery) is the default (MISSION ruling 14) | Whether a congregation may pick another tradition is an open question (§4). No table for any other tradition exists [Inferred] |
| Divine name in sung practice | Adonai/Elohim, confirmed for CRC (MISSION, Trope and audio) | It is unclear whether this is a CRC custom or product-wide. Default it to the same value and make it a setting only if asked [Inferred] |
| Service parts source | CRC's shirei-tfilah Beit Mitzvah volume feed (REVIEW rulings 28, 55). Under D12 the portal integrates the existing web siddur (shirei-shabbat repo, Beit Mitzvah volume) | Another congregation has no feed. Its service tab is empty or link-only until one exists. Whether the web siddur can serve another congregation's own volume is for Claude Code to check [Inferred] |
| Honoree blessings text | CRC's Beit Mitzvah booklet, under Daniel's CRC-specific permission (MISSION, 2026-10-18 amendment) | The other congregation supplies its own text, or the honoree pages are off [Inferred] |
| Mail sender | Resend on the verified centralreform.live domain (REVIEW §3.10) | The sender name per congregation. Whether to keep CRC's sending domain is an open question (§4) [Inferred] |
| App name and icon when installed | One manifest for CRC Torah (1.5 plan) | One manifest per host [Inferred] |

**Hard-coded CRC text** [Ruled: QUESTIONS E1 for the rule; the list is Inferred, found in approved strings]. Each of these must take `{productName}` or the tenant name before a second congregation sees it:
- "Everything else on CRC Torah is open without one." (QUESTIONS A2);
- "Or enter this code in the CRC Torah app" (A3);
- "No one from CRC will ever ask you for this code" (A3);
- "Written by Claude for CRC" (MISSION ruling 11 amendment);
- "Install CRC Torah on this device" (Batch B draft);
- the siddur link label.

Claude Code should grep the UI and the email templates for "CRC" and list each one.

#### b. What the congregation supplies

[Inferred list, built from the settings fields and the onboarding script]
- **Day one**, for the public Lein, Study and Learn to lein pages (these hold no people data):
  - the name, a product name and a hostname;
  - their own DNS CNAME;
  - diaspora or Israel;
  - one first admin, invited through the existing invitation flow.
- **Daniel's side:** the new Google OAuth origin and redirect URI on the existing Google project, and the Vercel domain.
- **For accounts:**
  - who approves;
  - the rabbi display name;
  - the consent notice text.
- **For the Beit Mitzvah workspace:**
  - service names and times;
  - preferred commentaries;
  - siddur and music links;
  - the roster, by CSV, because Maven is CRC's Salesforce and stays CRC-only;
  - tutors;
  - honoree blessing text, if they want honoree links;
  - a roster Sheet ID, if they want one.
- **Never supplied:** licensed texts in the repo, or recordings of learners. The standing rules hold for every congregation (MISSION ruling 24; handoff §2).

#### c. What Claude Code must check about tenant isolation

These are checks to run before Daniel's provisioning gate. The adversarial pass is required (MISSION, Proof; SPEC §3.7, "High-stakes work").

1. **Close the open Phase 2 gates** (STATE checklist): the two-tenant suite, the role matrix across two tenants, and the adversarial pass on auth and isolation.
2. **Tenant comes from the host, never from the client.** For every route, page and MCP tool, show that the tenant is resolved server-side from `tenant_host`. A request to tenant B's host must never read tenant A's rows, even with a forged id in the body, query or header.
3. **RLS is forced on every tenant-scoped table.** Walk the full list:
   - student, assignment, notes, honors, practice;
   - `tenant_settings`;
   - saved readings, verse marks, verse work and starred comments (0036);
   - account requests, members and approvers (1.4);
   - `mcp_connection` and `mcp_token`;
   - `student_source_identity`;
   - notifications;
   - audit.

   Check also that no runtime policy trusts a session variable a request can set.
4. **CDN caching of public routes.** `/api/public/*` is cached at the CDN by path; commentary is cached for 30 days. If any public response varies by congregation, the cache key must include the host, or tenant A's version is served to tenant B. Today's examples are preferred-source order and the siddur and music links. The simplest rule is to keep `/api/public/*` tenant-neutral and add tenant data only in uncached, host-checked responses.
5. **Sign-in and sessions.**
   - Cookies are host-only.
   - A session from one host is refused on another.
   - Magic links and the new 6-digit code are bound to the tenant and host that issued them.
   - The Google callback-log exception (MISSION, 2026-10-21) stays scoped to its one route.
   - The trusted-origin list grows per host, deliberately.
6. **Mail goes only within its own tenant.** An account request in tenant B emails only B's approvers. The approval email links only to B's origin. No digest crosses tenants.
7. **MCP.**
   - Each connection and token belongs to one tenant.
   - Discovery and OAuth resource metadata are per host.
   - `portal:roster` and the Maven tools refuse any tenant other than CRC.
   - Admin-only tool limits hold per tenant.
8. **Staff cannot read members' saved work in any tenant.** This includes Daniel as platform owner [Ruled: SPEC decision 10(4); MISSION accounts].
9. **The roster Sheet** for a non-CRC tenant writes only that tenant's rows, to that tenant's Sheet. It never falls back to CRC's environment Sheet.
10. **Offline and the service worker.** Each origin has its own worker and caches. Confirm that one deployment serving two hosts cannot share a cache across hosts. Sign-out and account switches still purge (R1.5 ruling 2).
11. **The generated-chant "report a mistake" queue** (VOICE M7) is described as "Daniel's admin queue". With two tenants, decide whether reports go to each congregation's admins or always to Daniel (§4). Either way, a report must not expose one congregation's members to the other.
12. **Audit rows and logs** carry the tenant and never another tenant's names. The "no person names in logs" rule holds.

**Cost and shape** [Inferred].
- Isolation checks and string clean-up: M.
- Multi-origin support in one deployment: M–L, including its adversarial review [Ruled shape: QUESTIONS D-a].
- Hosting adds little at this scale. Extra Google OAuth origins and a domain on the one Vercel project cost nothing extra. Stay inside the $10-a-month portal total (MISSION, 2026-10-22 spend rule).

### 1.3 Other 2.0 items: shape and cost

| Item | What it needs | Size [Inferred] |
|---|---|---|
| D'var Torah | Per-student draft table with a larger text limit than today's 4 KB; writing screen; tutor and rabbi comments; parent read access decided; its own MCP consent scope if Claude may read drafts (R1.5 §3D) | M |
| Web siddur integration [Ruled: D12] | Proper integration of the existing web siddur (shirei-shabbat repo, web-siddur, Beit Mitzvah volume) into the portal: the student's service parts open in the siddur, in place of a custom-built one. Claude Code to check how the siddur is served today and what a clean link or embed needs [Inferred] | M |
| Service course [Ruled: D12, E2] | A course for the service in the Learn to lein pattern: lessons, drills, review and a path, prayer by prayer. Each prayer also teaches about the prayer itself, using Daniel's own commentary and framing pulled from the shirei-shabbat and shirei-tfilah repos; Claude does not write that teaching fresh. Likely uses the siddur's service parts and the CRC Music link-out (REVIEW ruling 51). Needs a short design pass before sizing; open questions are in §4 [Inferred] | M–L **[Teaching clause superseded 2026-10-24: Claude drafts, Daniel approves each; no CRC Music link in 2.0; see MISSION.]** |
| Notifications switched on | Daniel picks which of the three kinds; global flag on; each congregation's switches | S |
| Indexing on | Remove noindex and the robots Disallow on chosen public pages | S |

---

## 2. Release 2.5: megillot, High Holy Day trope and blessings

**What is ruled.**
- "Blessings, High Holy Day trope and Megillot are **release 2.5**, not now" [Ruled: VOICE §1 Scope].
- They stay untouched until 2.5: "No change to blessings, High Holy Day trope or Megillot" [Ruled: VOICE §5].

- **Audio** [Ruled: QUESTIONS D-5]: generated chant per trope system, each after its own blind review, with a recording by Daniel or a song leader as the fallback. Blessings are text plus a CRC Music link.

**What is not ruled.** Nothing else about 2.5 is decided. Everything else below is [Inferred]: Cowork's reading of what each item needs.

| | Megillot | High Holy Day trope | Blessings |
|---|---|---|---|
| **Texts** | Esther, Ruth, Song of Songs, Lamentations and Ecclesiastes, pointed with trope, live from Sefaria (MAM), with credit. About 745 verses in all. Hebcal gives when each is read | The Rosh Hashanah and Yom Kippur Torah readings (Gen 21–22, Lev 16 and 18 or the Reform alternatives, the maftir readings). The text is the same as on other days; only the melody differs. Haftarot (1 Sam 1–2, Jer 31, Isa 57–58, Jonah) use the regular haftarah melody. Confirm which Reform alternatives CRC reads | Torah blessings before and after, haftarah blessings before and after, and megillah blessings. The texts come from the shirei-tfilah feed (REVIEW ruling 55) or CRC's booklet (MISSION, 2026-10-18) |
| **Trope systems** | Three new tables: Esther, Lamentations (Eicha), and the shared melody for Ruth, Song of Songs and Ecclesiastes. Each needs engine melody tables, drill cells, trope-chart rows and Learn to lein families | One new table: the High Holy Day Torah melody | Blessings are not cantillated. They are a fixed nusach melody per congregation, so they are a recording or a generated rendering of a fixed tune, not an engine table |
| **Source for the melodies** | The Binder/Avery tables are approved for public, noncommercial use (MISSION, 2026-10-15 amendment). Check whether the printed source covers these systems, and whether the permission covers those tables too. Printed-table accuracy checks stay open (MISSION, Open items) | Same check | CRC's own melody, as sung in services. Prayer audio links out to CRC Music (REVIEW ruling 51) |
| **Human recordings** | PocketTorah's 431 readings are Torah and haftarah only, so the portal has none for megillot. The cantor's licensed package includes megillah chant (VOICE M2 lists "megillah and blessings, per the catalog"), but playing it in the portal was cut (MISSION, 2026-10-22, later). It is voice training material only | None in the portal today. Whether the cantor's package holds High Holy Day trope is unknown | Not in the portal. The cantor's package lists blessings as training material |
| **Audio path** [Ruled: QUESTIONS D-5] | Generated chant after its own blind review for this system (see §3); fallback is a recording by Daniel or a song leader under the trope-song session rules (handoff §5.6) | The same | Text plus a CRC Music link-out (ruling 51) |
| **Size** | Engine tables and tests: M per system, with a parity check. UI and catalog: S. Voice: the cantor's megillah clips are fewer than the Torah and haftarah clips, so phone coverage per system needs checking | M | S for text and link-out; M if generated |
| **Cost** | Rendering about 750 more verses adds well under 0.1 GB of Blob storage: pennies a month (VOICE M8 rate) | Small | Small |

---

## 3. The generated chant voice: milestones to Daniel's G3 review

### 3.1 Standing rules

- **When it resumes.** The voice track resumes only after releases 1.2 to 1.5 ship. M0 is paused at a clean point on `claude/voice-m0` [Ruled: STATE, 2026-10-22, later]. The handoff's status table says it "waits until 1.5 is done".
- **G3 holds.** No student hears generated chant before G3 [Ruled: MISSION ruling 17; Boundaries].
- **Once it passes:**
  - it plays for everyone, signed-out visitors included [Ruled: STATE 1.5 rulings (5)];
  - human recordings play first, and generated chant fills only gap verses unless the student chooses it [Ruled: VOICE §1].
- **If the cantor-voice test falls short,** there is no studio session. Ship what passes the blind review, or generated chant waits for 2.0 [Ruled: STATE 1.5 rulings (9)]. This supersedes VOICE M2's "studio session option" ($500–1,500).
- **Spend.** Cloud GPU up to $25 in total without asking [Ruled: VOICE §1]. Rendering runs on the laptop.
- **Keys.** The student shifts the key live in the browser [Ruled: VOICE §1]. [Inferred] This replaces REVIEW ruling 58's four separate range renders; VOICE §1 says the browser key choice supersedes the earlier ±4-semitone ruling. Ask Daniel to confirm that ruling 58 is met by the live key shift (§4).

### 3.2 Milestones (VOICE §4)

| # | Milestone | Exit test | Daniel's time |
|---|---|---|---|
| M0 | Repo groundwork: the `voice/` folder, pinned environment, never-in-repo guards for `.onnx`, `.ds` and private-schema JSON, and the branch-only timing files brought to main | CI green; the guards refuse planted files | None |
| M1 | **Experiment 1** (EXP1): PocketTorah only, 12 held-out verses, three conditions. R is the real reader; O uses the real timing and pitch; S uses the engine | The ordered rule: Stopped early, then Invalid, then **Kill** (O misses the bar: stop for good), then Pass, then Promising (one retry). The bar is zero "would teach wrong", at least 10 of 12 "fine", and all 12 pass G1 and G2 | Two rounds of 15 minutes or less (two more if the retry runs) |
| M2 | The cantor's data: about 110 deduplicated clips (2.53 h), filters, a held-out set of about 30 verses | A counts table; every phone at least 20 times. A shortfall goes to Daniel. Under ruling (9) the remedy is not a studio session | None |
| M3 | Release model (two speakers) and our own vocoder; ONNX; hashes; weights backed up privately | Renders a held-out verse; G1 and G2 pass on the held-out set. If our vocoder is clearly worse, using the shared one is Daniel's licence decision | None |
| M4 | Cantor-voice evaluation: blind, generated against the real recordings | Zero "would teach wrong", at least 95% "fine", and the real recordings at least 95% "fine". One tuning round on failure; a second failure goes to Daniel | Two or three rounds of 15 minutes or less |
| M5 | Full render: about 7,500 verses plus 112 drill cells; G1, G2 and the sound check on every file | Failures under 1% of verses. A failing file is not published, and its verse stays text-only | None |
| **M6** | **G3, the system-level release gate.** The form is in §3.3 | See the pass rule below. The approval is recorded as the release identity | **About four rounds of 15 minutes or less** |
| M7 | Portal: the generated source behind `GENERATED_CHANT_PUBLIC_RELEASE` plus the approved identity hash in env; source choice; live key shift; the label; report a mistake; chart and drill buttons | App tests, never-in-repo, and a production-denial test | One key-shift check of 15 minutes or less |
| M8 | Operations: about 1 GB of Blob (about $0.10 a month); new model versions pass automatic checks only | The golden set matches or beats the approved version | None |

### 3.3 The G3 blind review form (M6)

**Pass rule** [Ruled: MISSION ruling 17; VOICE M6]. All three must hold:
- Zero "would teach wrong" in the 59 sampled verses.
- At least 95% "fine to learn from". In practice that is **57 of 59 or better**: 56 of 59 is 94.9% and fails.
- The hidden real recordings are at least 95% "fine". With about 7 hidden clips, that means all 7.

**Interpretations** [Inferred]:
- "Flag words" counts as not fine.
- The 10 drill clips must also have zero "would teach wrong". VOICE names the 59 verses for the 95% count but adds the drills to the sample.
- If the hidden real recordings fall below 95%, the review is **invalid** (miscalibrated), not a fail, as in EXP1 row 2. Fix the setup and run the rounds again.
- **On failure:** fix the cause, re-render, and draw a **fresh** sample. Never re-review the same 59 [Ruled: VOICE M6].

**The sample** [Ruled: VOICE M6]:
- 59 random verses from the M5 release set, stratified: about a third gap haftarot, a third other haftarot, a third Torah.
- Plus 10 drills.
- Plus about 10% hidden real recordings from the cantor (about 7).

That is about 76 clips over about four rounds. Each round is about 19 clips: about 15 verses, 2–3 drills and 1–2 real.

**The 15-minute check before each round** [Ruled: EXP1 step 9]. Total clip length plus about 3 seconds per tap must come to 15 minutes or less. If it doesn't, move the longest verses to another round, and record the change.
- At about 16 seconds per verse (VOICE M8's estimate), one round is about 5 minutes of audio, plus taps and replays: about 8–10 minutes.

**Format** [Ruled: EXP1 step 7, carried to M6 by M4's "same flag page and categories"]:
- All clips are matched for loudness (−20 LUFS, true peak at or below −1 dBTP) and encoded identically.
- Each clip has a random label. The key file is never shown.
- **No "Claude-generated chant" label on this page.** The review is blind.

**The page.** One private link; nothing else for Daniel to read (VOICE §6).

```
Round 2 of 4                                    Clip 7 of 19
-------------------------------------------------------------
Mark each one as you would for a student. Some clips are
real, some are generated.

  [ Play ]  [ Replay ]                         label: K4Q
  וַיְדַבֵּר  יְהוָה  אֶל־מֹשֶׁה  ...          (Hebrew with trope;
                                              each word can be tapped)

  ( ) Fine to learn from
  ( ) Flag words      -> tap the words above
                         reason (optional): [wrong sound] [stress]
                         [melody] [phrasing] [artefact]
                         note (optional): ________________
  ( ) Would teach wrong  -> tap the words above
                         note (optional): ________________

                                        [ Next clip ]
-------------------------------------------------------------
Your marks save as you go. You can stop and come back.
```

**Page behaviour** [Inferred, within the tone rules]:
- There is one choice per clip. "Next clip" waits until a choice is made, and until at least one word is tapped for "Flag words" or "Would teach wrong".
- Replay is unlimited.
- The page shows no running score and no pass or fail during the rounds.
- The round's end screen reads "Round 2 done. Your marks are saved." It has no summary of results.
- After the last round, Claude Code (not the page) computes the result against the pass rule and reports it to Daniel. The report gives counts by category, the flagged words, and whether the hidden real clips passed.
- Marks, labels and the key stay private under `C:/private/`. Only a counts-only summary may be committed (EXP1 step 10).
- **On a pass:** record the release identity, made of the hashes for the model, vocoder, engine, profile, timing model and ONNX Runtime, plus the manifest. That identity goes into env as the only switch that opens the generated path (VOICE M6, M7).

**Strings to check against the tone rules.** These are all plain, with no exclamation points and no praise:
- "Mark each one as you would for a student."
- "Fine to learn from"
- "Flag words"
- "Would teach wrong"
- "Next clip"
- "Your marks save as you go."
- "Round n done."

---

## 4. Open questions each release raises

One line each, with the recommendation first. Questions already ruled are left out.

### 2.0 and the second congregation
1. **ANSWERED (D11).** First contact is the second congregation's rabbi. Day one is public Lein, Study and Learn to lein plus accounts, under their own name and host; the Beit Mitzvah workspace comes later.
2. **ANSWERED (D-a).** One deployment serving several hosts, after the two-tenant suite and the adversarial pass.
3. **ANSWERED (D-b).** JPS 2023 is covered for other congregations under the existing arrangement. Nothing to ask JPS.
4. **The mail sender for another congregation.** Recommend: keep sending from the verified centralreform.live domain, with the congregation's name as the sender name. That avoids new DNS work and spend.
5. **Melody tradition per congregation.** Recommend: Binder/Avery for everyone at first. Add another tradition only when a congregation asks and its tables are licensed.
6. **Where "report a mistake" goes for another congregation.** Recommend: always to Daniel's queue, because the generated voice is one shared release. Never show the reporter's identity across congregations.
7. **D'var Torah: may parents read drafts, and may Claude read them through the MCP?** Recommend: tutors and rabbis only, and no MCP access without its own consent scope.
8. **Which notifications go on at 2.0.** Recommend: the tutor draft notice only at first. Add the parent digest once a real pilot shows it is wanted.
9. **ANSWERED (F2), and moved to 1.5.** Index `/read`, `/learn` and `/trope-chart` at the 1.5 beta tag, per MISSION's "noindex until beta". Signed-in pages and every workspace stay noindex.

### 2.5
10. **ANSWERED (D-5).** Megillot and High Holy Day trope use generated chant per trope system, each after its own blind review, with a recording by Daniel or a song leader as the fallback.
11. **Does the Binder/Avery permission cover the megillot and High Holy Day tables?** Recommend: confirm with the source, as with the Torah and haftarah tables, before any table enters the repo.
12. **ANSWERED (D-5).** Blessings are text plus a CRC Music link.
13. **Which High Holy Day Torah readings CRC uses, traditional or Reform alternatives.** Recommend: support both through "any reading". Mark CRC's choice only if Daniel asks.

### The voice
14. **Is ruling 58 (bass, tenor, alto, soprano) met by the live key shift?** Recommend: yes. A key range of ±7 semitones covers the four ranges without four renders, with the M7 key-shift check as the test.
15. **ANSWERED in part (D-5): each 2.5 chant system gets its own blind review.** Still open, the size: recommend about 20 verses per system, same form and pass rule.
16. **The vocoder if our own is clearly worse.** Recommend: do not ship the shared non-commercial one. Ship nothing until our own one passes M4.

### The 2.0 service course (new, raised by E2)
17. **Is the course open to everyone, like Learn to lein, or only to signed-in students?** Recommend: open to everyone, since the prayer texts and Daniel's teaching are public in the repos.
18. **Which service does the course cover first?** Recommend: the Shabbat morning parts a Beit Mitzvah student leads, from the Beit Mitzvah volume.
19. **What if a prayer has no teaching from Daniel in either repo?** Recommend: show the prayer without teaching and list the gap for Daniel; Claude does not fill it.
20. **Who signs off on the teaching as pulled into the course?** Recommend: Daniel reviews each prayer's teaching once before it goes live, since extracts can lose context.
21. **Audio for learning the service.** Recommend: link out to CRC Music for melodies (ruling 51); no new recordings or generated audio for prayers in 2.0.
22. **Another congregation's service course.** Recommend: CRC only at first; another congregation sees it only when it supplies its own volume and teaching.

---

## 5. Batch D and E status

1. **The second congregation (D11): ANSWERED 2026-10-23.** First contact is its rabbi; day one is the public pages plus accounts; the Beit Mitzvah workspace later.
2. **Hosting shape (D-a): ANSWERED 2026-10-23.** One deployment serving several congregations by host, after the two-tenant isolation suite.
3. **The JPS licence (D-b): ANSWERED 2026-10-23.** Covered for other congregations; no JPS note needed.
4. **What 2.0 is for (D12): ANSWERED 2026-10-23, with a change.** 2.0 does not build a custom siddur. It integrates the existing web siddur (shirei-shabbat repo, including its Beit Mitzvah volume) properly and adds ways for students to learn the service. Out of beta, D'var Torah, chosen notifications and public-page indexing stand as drafted.
5. **The 2.5 audio (D-5): ANSWERED 2026-10-23.** Generated chant per trope system, each after its own blind review, with a recording by Daniel or a song leader as the fallback; blessings as text plus a CRC Music link.
6. **Naming (E1): ANSWERED 2026-10-23.** `productName` is a per-congregation setting; CRC credit stays in the footer.
7. **Learning the service (E2): ANSWERED 2026-10-23.** A service course in the Learn to lein pattern that also teaches about each prayer, using Daniel's own understanding from the shirei-shabbat and shirei-tfilah repos.
