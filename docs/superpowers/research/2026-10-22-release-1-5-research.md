# Release 1.5 — research and recommendations

Researched 2026-10-21 (night), for Daniel's morning read. Read-only research against `main` at `e5859c5` (worktree `bneimitzvah-study`), the planning record, and targeted web sources. No code, store, account, spend or provider call. No student or family data appears here.

Labels: **[verified]** means I read it in the repo or in a primary or official source today. **[inferred]** means my reasoning, a secondary source, or a claim that needs a device test.

## 1. Recommendation in one page

1.5 should be **"practice anywhere, and send it to your tutor."** Three things, in this order:

1. **Student recordings, finished and switched on.** Record a take, listen back, send it to the tutor, delete it. The tutor listens and leaves a note. Deletion runs one year after the ceremony. This is the biggest missing piece of the teaching loop. MISSION ruling 15 says of recording: "here it is the point."
2. **Installable app with offline current audio.** Add to Home Screen, the student's current reading and reference audio work with no signal, and takes recorded offline send on the next open.
3. **Tutor and clergy reference uploads (ruling 16), if coverage needs them.** These use the same upload path as student recordings. They fill readings that PocketTorah does not cover. Measure the gaps before building this.

Keep out of 1.5:

- **D'var Torah drafting.** Your working proposal includes it, but your binding study-guide ruling S3 (2026-10-21) says "D'var Torah stays in 2.0." I recommend keeping S3. If you want it sooner, it is a clean medium-sized 1.6 item (section 3D).
- **Generated chant.** It stays a research track behind G1/G2/G3. The next step is the four-passage human-reference session in the existing benchmark plan. No student hears any of it.
- Four vocal ranges (they only apply to generated chant), custom siddur export (v2.0), a second congregation (your gate).

One engineering change matters more than any feature choice. **Simplify the recording upload.** The parked work records raw 24 kHz WAV (2.88 MB a minute). That is too big for one Vercel request, which forced a long chain of delegated-upload, chunking and late-upload proofs. All current phone browsers can now record compressed Opus or AAC. A ten-minute compressed take fits in one ordinary request to the portal. The server then writes the file itself, and no upload permission ever leaves the server. Most of the unsolved "can an old upload still land later?" problem goes away. The recording ledger already in production (migration 0020) allows exactly these two formats. Section 3A has the details.

Rough size: recordings **L** (about 2–3 weeks of agent work, reviews included), offline **M**, reference uploads **M**. Expected extra hosting is **under about $2 a month** in a typical month (section 5).

## 2. Where things stand tonight

- 1.0 releases tonight: reading and reference playback, word tools, study guides, honors, tikkun and practice sheet, rehearsals, settings, roster Sheet, Maven intake, portal MCP. [verified, STATE.md top]
- 1.1 is notifications. The code is on branch `claude/notifications`, not on `main`. [verified, `git branch -a`; no notification files under `src/` on main]
- **Student reference audio is still not switched on for students.** `REFERENCE_AUDIO_STUDENT_RELEASE` waits on your listening acceptance (`src/server/runtime/config.ts`; STATE "Daniel's own gates"). Offline audio is pointless until that switch is on. [verified]
- Recordings are parked by your 2026-10-17 ruling (MISSION "Current 1.0 scope"). Some internal foundations are deployed, but no feature is. [verified]
- The private Blob store exists, Production-only, on OIDC, within your approved $5–8/month planning target. [verified, MISSION spend approval; STATE "Native media acceptance"]

## 3. The candidates

Sizes: **S** = 1–2 agent-days. **M** = 3–6 agent-days. **L** = 2–3 weeks. All include the required adversarial review.

### 3A. Student recordings (recommend: yes, first)

**What already exists** [verified]

| Piece | Where | State |
| --- | --- | --- |
| Recording ledger table, RLS forced, lifecycle trigger (private → submitted → deleting), automatic "deleting" when a ceremony anniversary passes | `src/server/db/migrations/0020_student_recording_ledger.sql`, `src/server/db/recording-schema.ts` | Applied in production; table empty |
| Allowed formats | same migration: `audio/webm;codecs=opus`, `audio/mp4;codecs=mp4a.40.2`; ≤32 MiB; ≤10 minutes | Matches compressed recording exactly |
| List / submit / delete-request service with fresh authority checks and parent-dashboard exclusion | `src/server/recordings/service.ts`, `authority.ts`, `src/server/data/recordings.ts` | Code exists |
| HTTP routes `GET /api/students/:id/recordings`, `POST …/:rid/submit`, `POST …/:rid/delete` | `src/server/http/recordings.ts`, wired in `src/server/http/dispatch.ts` and `runtime/composition.ts` | Live routes; they return only an empty list, because nothing can create a row yet |
| Internal "register a verified file" seam | `src/server/recordings/registration.ts` | Server-internal; no public route |
| Retention rule (one calendar year after ceremony, Feb 29 handling) | `src/server/recordings/policy.ts`, `retention.ts` | Code exists |
| Headless microphone capture: AudioWorklet, mono 24 kHz PCM WAV | `src/components/portal/workspace/recordings/capture.ts`, `public/recording-capture-worklet.js` | Not wired to any screen |
| Exact-WAV byte verifier | `src/server/recordings/media-wav.ts` | Unwired |
| Private Blob store, Production-only OIDC, synthetic object round passed | STATE "Native media acceptance" | Live |
| Parked branches: manifest/chunk finalization, receipt admission, media transport, single-read diagnosis | `codex/recording-*` branches | Not on main; STATE says never merge wholesale |

**What is missing**

- Any student or tutor screen: record, play back, send, delete; a tutor list of sent takes.
- An upload path that actually stores bytes and registers them.
- A link from a take to *what* it is (assignment and verse range). The 0020 row has no material binding; STATE's inventory lists this as open.
- Tutor feedback on a take, and a "heard" mark. Today `tutor_note` is per verse (`src/server/db/student-work-schema.ts`).
- The physical deletion worker. The trigger marks rows "deleting", but nothing removes the file yet.
- The family notice text that ruling 49 requires (storage, who can hear, one-year deletion).
- A phone test. The capture code requests an AudioContext at exactly 24 kHz and fails if it gets another rate. That has never been tried on an iPhone. [verified code; phone behaviour unknown]

**The simplification I recommend** [inferred design; facts verified]

- Record with `MediaRecorder`, choosing by `isTypeSupported`: WebM/Opus first, MP4/AAC second. Safari 18.4 added WebM/Opus recording; earlier Safari recorded MP4/AAC only. [verified, WebKit Safari 18.4 notes] Chrome and Android record WebM/Opus. [inferred, long-standing]
- At about 48 kbps mono, ten minutes is about 3.6 MB. A Vercel Function accepts a 4.5 MB request body. [verified, Vercel limits page, updated 2026-08-24] So one take is one ordinary authenticated POST to the portal.
- The server checks authority, size, the file's first bytes (WebM or MP4 signature), and its SHA-256. It writes the file to private Blob under a random key it chooses, with overwrite off. It then registers the ledger row. The client never holds an upload grant, so there is no grant to revoke and no late upload to fence off.
- Playback: one same-origin route. It re-checks authority on every request and returns the whole file (under 4.5 MB) with `private, no-store`. The existing reference player already plays fetched bytes through a blob URL, so no range support is needed. [verified, `src/lib/reference-audio/playback.ts`]
- Deletion: a daily cron finds "deleting" rows, deletes the object, and confirms absence with an uncached read. It records a tombstone time. Vercel Pro already runs two crons here (`vercel.json`). [verified]
- What this gives up: the server no longer proves a file is a valid, exact PCM stream. It checks the signature, the size, and a client-reported duration within limits. Only the student and their tutor or admin ever hear the file. I think that is the right trade for a teaching tool. It needs your agreement only because it reverses an earlier engineering choice (see open items).
- Known snag: Chrome's WebM recordings often carry no duration, so a player can show "Infinity" until the file loads. Fix it by storing the client-measured duration, or by patching the WebM duration header on the client. [inferred, widely reported]

**Risks**

- **Children's voices.** Federal COPPA counts "an audio file … [that] contains a child's … voice" as personal information. [verified, FTC COPPA FAQ, section A.3] COPPA "applies to commercial websites and online services and not to nonprofit entities", except nonprofits run for commercial members. [verified, FTC FAQ, section B.5] CRC is a nonprofit congregation, so COPPA probably does not bind this portal. That is a legal question for CRC's counsel, not a finding. The FTC still encourages nonprofits to follow COPPA-style practice. [inferred, secondary sources] The amended rule's compliance date was 2026-04-22. [verified, law-firm summaries] It also expects a written retention policy, and your one-year rule already is one. My recommendation: keep the notice from ruling 49, and for under-13 students show it once to the parent with an "I've read this" tick. That is not a consent gate; whether to add it is your call.
- **Who can hear.** The student, the delegated child-practice view, and assigned tutors and admins for *sent* takes only. Never the parent dashboard (ruling 1). The existing service already enforces this. Keep it. [verified, `service.ts`]
- **Mistakes cannot be recalled.** Once a tutor's browser has played a take, its bytes cannot be pulled back. Deletion stops later plays only. Say so in the notice. [inferred]
- **Cost.** It is small with compression (section 5). Raw WAV would cost about six times more. [verified ratio, spend notice]
- **Licensing.** None for the student's own voice.

**Gates**

- Your ruling to unpark recordings (MISSION parks them).
- Adversarial review of recording access, tenancy and deletion (CLAUDE.md "high-stakes").
- The family notice wording (student-visible wording with no precedent).
- No G3: this is human voice, not generated chant.
- A real iPhone and Android test before switch-on, behind a default-off flag like `PORTAL_MCP_ENABLED`.

**Size: L.** Rough split: compressed capture and recorder UI, M; upload, verify and register route, M; tutor inbox, playback and notes, M; deletion cron and migration, S–M; review and phone tests, S–M.

**Recommendation:** build it first. Reuse the 0020 ledger and service. Add one additive migration for the material link, tutor feedback and tombstone. Retire the WAV and chunk path rather than finishing it. Wire the tutor "new recording" email into 1.1's notifications.

### 3B. Installable app with offline current audio (recommend: yes, second)

**What already exists** [verified]

- Nothing of the app shell: no `app/manifest.ts`, no service worker, no icons. `public/` has only fonts and the capture worklet.
- Reference clips are served from `/reference-audio/short-v1/<sha256>.mp3` as `public, max-age=31536000, immutable`, content-addressed (`src/server/reference-audio/public-short.ts`). They are ideal to cache.
- The player checks every clip's SHA-256 before playing (`src/lib/reference-audio/playback.ts`). Cached bytes get an integrity check for free.
- Plan of record: PLAN-REVIEW §3.9 and ruling 53 (installable; current audio offline; offline recordings upload later; a cache the app controls is "not a download"). MISSION's open item: settle the offline lease length before release.

**What is missing**

- A manifest, icons, `display: standalone`, and an iOS "Share → Add to Home Screen" hint. Next.js supports `app/manifest.ts` natively. [verified, Next.js PWA guide, updated 2026-07-30]
- A small hand-written `public/sw.js`. It caches the app shell, fonts, the student's current clips, and one explicit "offline pack" per student and assignment revision (text and timings), with an expiry. Serwist is the Next.js docs' suggested library, but a short worker adds no dependency. [verified that the docs suggest it; my choice is inferred]
- Purge on sign-out and on account or child switch. Never cache general private API responses (MISSION open item).
- An IndexedDB queue for takes recorded offline, with a visible "waiting to send" list. It sends on the next open. Safari and iOS Safari have no Background Sync, up to version 27 (Chrome Android has it). [verified, caniuse] Queued takes past their deletion date must be deleted on the device.
- `navigator.storage.persist()`. WebKit grants it "based on heuristics like whether the website is opened as a Home Screen Web App". A Home Screen app gets the same quota as Safari, up to 60% of disk per site. [verified, WebKit storage-policy post] Storage is still best-effort, so the app must handle eviction.

**Risks**

- **Sign-in inside the installed app (top risk).** iOS Home Screen web apps keep "separate cookies and storage from the browser". [verified, WWDC23 "What's new in web apps"] A magic link tapped in Mail opens Safari, not the installed app [inferred], so the student ends up signed in in Safari but signed out in the app. Google sign-in leaves the app's scope and may not come back [inferred, older reports]. This combines with tonight's known phone sign-in failure. Fix: add a short one-time code in the sign-in email that can be typed into the app. This is an auth change, so it gets an adversarial review. Test Google redirect mode inside the installed app on a real iPhone.
- **Lock-screen playback.** Audio in installed iOS web apps has a history of stopping in the background, and lock-screen controls have been unreliable. [inferred from WebKit bug reports, 2019–2023; no 2026 confirmation found] Do not promise "practice with the screen off". Test it and say what works.
- **The CC BY-SA licence on the PocketTorah clips** forbids "effective technological measures" that restrict reusers (licence §4(a), quoted in `REFERENCE-AUDIO-CONTRACT.md`). The offline cache must not encrypt or lock the clips. Ruling 14's "no export button" is fine. [verified contract text]
- **G3.** The worker must cache only allow-listed, released paths. Add a test that a generated or unreleased render can never be cached or played offline (PLAN-REVIEW "Offline cache and G3"). There is no generated chant today, so this is a guard, not a feature.
- **Privacy.** On-device copies of the student's text and audio are low-sensitivity: scripture and public reference audio. Offline takes are the sensitive part; they stay on the device until sent. A shared family iPad is the main exposure. Purge on account switch covers it.
- **Cost.** It cuts traffic, because clips are fetched once.

**Gates:** your offline lease length (open item); your reference-audio listening acceptance first; adversarial review of the cache-scope and purge logic and of any auth change; a device test.

**Size: M.** The install shell alone is **S** and can ship early. Offline audio and the pack are M. The offline recording queue is S on top of 3A.

**Recommendation:** ship the install shell as soon as the sign-in fix is proven inside the installed app. Then offline audio after your listening acceptance. The offline recording queue lands with 3A.

### 3C. Tutor and clergy reference uploads (recommend: yes, if coverage needs it)

- **Exists:** ruling 16 (a tutor or the rabbi can upload a per-verse recording as the interim source). The parked private review of a cantor's collection is in `docs/superpowers/specs/2026-10-21-finkel-private-review-design.md`: 322 clips, none approved, parked by you. PocketTorah gives 7,036 playback-ready, word-mapped cuts (STATE "Fresh private recheck"). [verified]
- **Missing:** an upload screen for staff; a `reference_recording` table (planned in PLAN-REVIEW §3); a per-clip listening approval before students hear it; word timings, which the player needs to highlight (verse-only play could come first).
- **Risks:** written consent from each adult whose voice is used, and its scope (playback to CRC students only, not training). The cantor's collection needs the licence that MISSION lists as open. Cost is negligible.
- **Gates:** your licence decision for the cantor's material; your listening approval per clip; adversarial review (it shares the recording path).
- **Size: M** after 3A, since the upload path is shared.
- **Recommendation:** first measure how many verses on the real roster's readings lack a PocketTorah cut (an agent can count this from the private index without exposing data). Build this only if the gap is real.

### 3D. D'var Torah drafting with tutor feedback (recommend: not in 1.5)

- **Rulings:** ruling 30 says "after 1.0", with room reserved. Your newer spec ruling S3 (2026-10-21) says "D'var Torah stays in 2.0 … No reflection prompts, no drafting space, no free-text study writing for students in this work." PLAN-REVIEW puts it in v2.0. The 2026-10-20 external review notes that CRC already runs 6th-grade d'var work with the rabbis. [verified]
- **Exists:** a clean pattern to copy. `translation_draft` and `tutor_note` in `src/server/db/student-work-schema.ts` are append-only, versioned, tenant-scoped, and cover the student and child-practice modes. The planned `dvar_torah_draft` kind is reserved but not built. [verified]
- **Missing:** a per-student (not per-verse) draft table with a larger text limit (today's is 4 KB, and a d'var runs about 4–6 KB); a writing screen; tutor and rabbi comments; a decision on whether parents can read drafts.
- **Risks:** a child's writing is personal information, so keep it student and staff only. No student-facing AI writing help (ruling 11). Letting Claude read drafts through the MCP would widen what the MCP sees into children's writing; give that its own consent scope, as with `portal:roster`.
- **Size: M.**
- **Recommendation:** keep S3. Revisit as 1.6 or 2.0 with the rabbis' existing 6th-grade process in view. If you overrule S3, it can go last in 1.5.

### 3E. Generated chant (recommend: research track only)

- **Exists:** the engine and the SoulX render path (`trope/render-cli.mjs`, `soulx_runner.py`, `modal_render.py`), the speech-to-singing experiment, melody and cents code (`trope/melody.mjs`), the 2026-10-16 reassessment, and the twelve-passage benchmark plan (`docs/superpowers/plans/2026-10-16-chant-renderer-benchmark.md`). [verified]
- **Missing:** the first human reference session (four passages: P01, P02, P09, P11), the A/B benchmark run, G1/G2 automation over a release set, the G3 review page, and release identity with range.
- **New since 2026-10-16:** a targeted search found no new open Hebrew singing or cantillation model. Hebrew speech TTS exists, but not singing. [inferred from search results; absence is hard to prove] The reassessment stands.
- **Risks:** a teaching error is the risk that matters (G3: zero "would teach wrong"). Licensing varies by model weights (for example, Phonikud-TTS is non-commercial and academic-only); see the reassessment's table. Cost is $0 on the RTX 4070; Modal would be a new spend and needs you. Voice consent applies to any human prompt.
- **Gates:** G1, G2, G3; your consent and recording session; any cloud spend.
- **Recommendation:** time-box one research slice in 1.5. Record the four-passage human reference (your voice) and run lanes A and B against it. No student-visible change. Stop and report if both fail.

### 3F. Smaller candidates

| Candidate | Exists | Recommendation |
| --- | --- | --- |
| Web push reminders on the installed app | Nothing. iOS 16.4+ supports push only for Home Screen apps. [verified, Next.js PWA guide] VAPID keys are free. | 1.5 stretch after 1.1 email. Opt-in only. S–M. |
| Pitch shift of reference audio to a student's range | Desirable per MISSION, "only if speed and text alignment remain correct" | Research spike only. Quality risk on human recordings. S. |
| Four vocal ranges | Applies to generated chant only | Wait for 3E. |
| Custom siddur and packet export | v2.0 by ruling 44 | Out. |
| Second congregation | Settings and onboarding script live (PR #12) | Your gate. Out unless one appears. |
| Tutor practice-days view, Maven unlink | Gaps noted in tonight's 1.0 audit | Small follow-ups for 1.1. |

## 4. Proposed order

| Step | Content | Depends on | Size |
| --- | --- | --- | --- |
| 0 | 1.1 notifications ships | — | (in progress) |
| 1 | Recording capture spike on a real iPhone and Android: `MediaRecorder` formats, permission prompts in Safari and in the installed app, file sizes | Your unpark ruling | S |
| 2 | Recordings backend: upload, verify, register; playback; migration for material link, feedback and tombstone; deletion cron | 1 | M–L |
| 3 | Recorder and tutor inbox screens; family notice; default-off flag; adversarial review; switch on | 2, notice wording | M |
| 4 | Install shell plus in-app sign-in code | Auth review | S–M |
| 5 | Offline pack and audio cache; offline take queue | Your listening acceptance; lease length | M |
| 6 | Coverage count; then tutor and clergy uploads if needed | 2 | S, then M |
| — | Parallel research: chant benchmark lanes A/B | Your recording session | time-boxed |

## 5. Cost against the $25–50 cap

I used the spend notice's formula (`storage × 0.023 + uploaded × 0.11 + played × 0.17`, $/GB, iad1). Its rates still match Vercel's Blob pricing page, updated 2026-09-23: storage $0.023/GB-month, simple operations $0.40 per million, advanced operations $5 per million, transfer $0.05/GB, Fast Origin Transfer $0.06/GB. [verified] Same assumptions as the spend notice: 34 students, takes kept for about 21 months on average. Compressed at 48 kbps (about 1.08 MB per three-minute take). [inferred estimates]

| Scenario | Takes | Recording cost/month, compressed | Same scenario, raw WAV (spend notice) |
| --- | --- | ---: | ---: |
| Light | 1 × 3 min a week | ≈ $0.15 | $1.74* |
| Typical | 3 × 3 min a week, 3 replays | ≈ $0.55 | $4.76* |
| Heavy | 5 × 10 min a week, 5 replays | ≈ $4 | $32.26* |

\*The spend notice's totals also include reference listening. My compressed figures do not. Reference listening adds at most about $0.50 a month in the typical case. The clips are public and CDN-cached, and offline caching cuts repeat fetches further. Server-side uploads count as Fast Data Transfer, which likely falls inside the team's included 1 TB. [inferred] Database rows are negligible. Web push is free. Offline caching lowers cost.

**Total extra for 1.5: about $1–2 a month typical, about $5 heavy.** That is inside your approved $5–8 planning target and far under the cap. No new paid service is needed. Only cloud GPU time for chant research would be new spend, and it is not proposed.

## 6. Research findings at a glance

| Question | Finding | Status | Source |
| --- | --- | --- | --- |
| iOS recording formats | Safari 18.4+: WebM/Opus, fragmented MP4, ALAC/PCM. Before 18.4: MP4/AAC only | verified (18.4); inferred for iOS 26/27 | WebKit Safari 18.4 post |
| Chrome/Android recording | WebM/Opus long supported; MP4 audio support version not confirmed | inferred | MDN isTypeSupported |
| Function body limit | 4.5 MB request or response | verified | Vercel Functions limits |
| Private Blob delivery | Through your own function; presigned GET/PUT now exist (PUT can enforce type and size; max 7-day token; no revocation documented) | verified | Vercel private storage; signed URLs |
| Blob pricing | Unchanged from the spend notice | verified | Vercel Blob pricing |
| iOS storage | Home Screen app gets the same quota as Safari (up to 60% of disk per site); `persist()` granted by heuristics; eviction by least recently used | verified | WebKit storage-policy post |
| iOS 7-day script-storage purge | Applies to Safari use; Home Screen apps count their own use. No 2026 change found | inferred (old secondary sources) | search results below |
| Background Sync | Not in Safari or iOS Safari through 27; Chrome Android yes | verified | caniuse |
| Installed-app cookies | Separate from Safari | verified | WWDC23 notes |
| Background or lock-screen audio in installed apps | Historically unreliable; no 2026 fix found | inferred | WebKit bugs |
| COPPA and voice | Voice audio is personal information; nonprofits are generally outside COPPA; amended rule compliance date 2026-04-22 | verified (FAQ); date from law-firm summaries | FTC FAQ; Hunton |
| Hebrew singing synthesis since 10-16 | Nothing new found | inferred | search |

## 7. Open items that wait on Daniel

1. **Do you unpark student recordings for 1.5?** Recommended: yes. Recordings first, behind a default-off flag until phone tests and review pass.
2. **May we switch from raw WAV to compressed Opus/AAC recording, uploaded in one request through the portal?** Recommended: yes. It removes the delegated-upload problem and cuts storage cost about sixfold. The server checks signature, size and hash instead of decoding the audio.
3. **What should the family recording notice say, and do parents of under-13s tick "I've read this" once?** Recommended: a short notice (who can hear, private until sent, deleted one year after the ceremony, deletion cannot recall a take already played), with a one-time parent acknowledgement that does not block practice. Ask CRC's counsel whether COPPA or Missouri law applies; I expect not, for a nonprofit.
4. **How long may the installed app keep practice material offline without checking in?** Recommended: 14 days, renewed on every online open, purged on sign-out or account switch.
5. **May sign-in emails carry a short one-time code that can be typed into the installed app?** Recommended: yes. Without it, iPhone users who sign in by email stay signed out of the Home Screen app.
6. **Does D'var Torah stay in 2.0 (your ruling S3)?** Recommended: yes. Revisit with the rabbis' existing 6th-grade process. If you overrule it, it goes last in 1.5.
7. **Will you record the four benchmark passages yourself so chant research can continue?** Recommended: yes, a short session with no student exposure. G3 stays untouched.
8. **Should tutors and clergy be able to upload reference recordings?** Recommended: only if the coverage count shows real gaps. Each voice gives written consent limited to playback for CRC students. The cantor's collection waits on its licence.
9. **When will you do the reference-audio listening acceptance?** Offline audio has no value until students can hear reference audio at all. Recommended: before step 5 of the order above.

## Sources

- WebKit, "WebKit Features in Safari 18.4" — https://webkit.org/blog/16574/webkit-features-in-safari-18-4/
- WebKit, "Updates to Storage Policy" — https://webkit.org/blog/14403/updates-to-storage-policy/
- WWDC23 "What's new in web apps" notes — https://wwdcnotes.com/notes/wwdc23/10120
- caniuse, Background Sync — https://caniuse.com/background-sync
- MDN, `MediaRecorder.isTypeSupported()` — https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/isTypeSupported_static
- Next.js, PWA guide — https://nextjs.org/docs/app/guides/progressive-web-apps
- Vercel, Functions limits — https://vercel.com/docs/functions/limitations
- Vercel, Blob pricing — https://vercel.com/docs/vercel-blob/usage-and-pricing
- Vercel, Private storage — https://vercel.com/docs/vercel-blob/private-storage
- Vercel, Signed URLs — https://vercel.com/docs/vercel-blob/vercel-signed-urls
- FTC, "Complying with COPPA: Frequently Asked Questions" — https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions
- Hunton, "FTC Publishes Final COPPA Rule Amendments" — https://www.hunton.com/privacy-and-cybersecurity-law-blog/ftc-publishes-final-coppa-rule-amendments
- WebKit Bugzilla, standalone web app audio stops in background (2019) — https://bugs.webkit.org/show_bug.cgi?id=198277
- WebKit Bugzilla, AudioContext suspended in background (2023) — https://bugs.webkit.org/show_bug.cgi?id=261858
- Secondary, iOS 7-day storage cap (2020) — https://mjtsai.com/blog/2020/03/26/
- Repo: MISSION.md, STATE.md, PLAN-REVIEW.md, `docs/superpowers/research/2026-10-16-chant-rendering-reassessment.md`, `2026-10-17-private-media-spend-notice.md`, `2026-10-17-private-recording-storage.md`, `2026-10-17-private-upload-quiescence.md`, `docs/superpowers/specs/2026-10-21-torah-study-guides-design.md`, `docs/planning/2026-10-17-recording-foundation/INVENTORY.md`, `docs/planning/2026-10-17-reference-audio/REFERENCE-AUDIO-CONTRACT.md`.
