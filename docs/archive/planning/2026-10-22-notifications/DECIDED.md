# Release 1.1 email notifications

## Settled decisions (Daniel, binding)

- 2026-10-21: email notifications follow 1.0: tutor draft notices, weekly parent digests and opt-in student reminders (MISSION "Teaching and progress"). Recordings are parked, so there are no recording notices.
- Ruling 14: parents and others see days practiced only, never raw practice events, recordings or other students.

## What ships

- **Tutor draft notice.** When a student (or a parent in child practice) saves a new translation draft, each live tutor assigned to that student gets one short email with the portal's address. At most one per tutor, student and Central-time day. The notice is queued inside the draft's own write (in a savepoint, so it can never cost the student the draft), sent right after the reply, and otherwise by the morning run within two days.
- **Weekly update.** On the congregation's chosen weekday (Sunday unless set), each parent of a current child student gets one email covering their own children: days practiced in the last 7, lesson-log entries dated since their last update, verse-note count, the upcoming ceremony date and service, and upcoming rehearsals. An adult student can turn on the same update for themselves. Only students whose ceremony is today or later are included.
- **Practice reminder.** A student with their own sign-in can turn on a weekly reminder on a day they pick. Off by default; children without their own sign-in have no student grant and get none.
- **Controls.** Three congregation switches in Congregation settings (all off by default) and the deployment switch `PORTAL_NOTIFICATIONS_ENABLED` (on only when exactly `true`). Nothing sends unless both are on. Members turn each kind off (or a reminder on) at `/workspace/email`; every email has a signed one-click unsubscribe for that member and kind (`List-Unsubscribe` and `List-Unsubscribe-Post`) and says why it came.
- **Delivery.** Resend, through a notification transport beside the existing one. A daily Vercel cron at 14:05 UTC (9:05 CDT / 8:05 CST) calls `/api/internal/notifications/run` with the `CRON_SECRET` bearer. The ledger `notification_delivery` holds one row per (member, kind, period), claimed before the provider is called; its id is Resend's `Idempotency-Key`.

## Decided here (Daniel may overrule)

- Product name in mail bodies is the congregation's `tenant.product_name` (CRC: "CRC B'nei Mitzvah"), as the sign-in and invitation mails already use. The weekly subject is the fixed "Your weekly Beit Mitzvah update".
- Subjects never name a student. Bodies use first names only, and only of students the recipient may already see.
- Links are the portal's address (`/`), the member's email settings and the unsubscribe page; never a link that opens content without signing in.
- Lesson entries are chosen by lesson date: from the day of the member's previous update through yesterday (so consecutive weeks do not overlap). An entry dated earlier but written later is not in any update; it is still in the portal.
- Parents' updates cover child students only (an adult is their own contact). An adult student's own update is opt-in.
- A parent who is also an adult student gets their children's update by default; their own part is added only once they turn the weekly update on, so with no saved choice their email settings show it off and say "Turn it on to include your own as well." One choice covers both parts: turning it off (there or from an email) stops both.
- A scheduled update or reminder the morning run misses is sent up to two days late, never later, and never twice in a week even if the day changes.
- Retries: a definite provider refusal (a 4xx, including 429) is retried (same idempotency key) up to three attempts within three days, and never once that member already had this week's message; a send with no answer or a provider 5xx is never retried automatically, because it may have arrived.
- Each run sends at most 40 messages, stops after 45 seconds, and spaces sends 0.6 s apart (Resend's default rate limit is 2 per second). Candidates are only parents of current child students (ceremony today or later) and opted-in adults who have not had this week's message, so past classes never crowd out current families; what a run cannot reach is reported as `deferred` and goes on the next morning within the catch-up days. A run with refusals, unanswered sends or deferrals logs one line of counts (never an address, name or token).
- One item that throws does not stop the morning run: it is counted as failed when nothing was handed to the provider (its claim rolls back), and a row already handed over stays claimed and is never sent again. Failed rows with no attempts left are not fetched, so they cannot crowd out retryable ones.
- Known and accepted (review L1): two runs overlapping exactly while an admin changes the digest weekday could each compute a different period for the same member; the once-a-week check makes a second send unlikely but not impossible in that window. The cron runs once a day, so this is left as is.
- The weekly update counts new tutor notes by verse (an edited note is one verse, not several notes).
- Unsubscribe from the email body opens `/unsubscribe#t=...` (the token stays in the fragment and is cleared from the address bar); that page POSTs the token in the form body (`List-Unsubscribe=One-Click&t=...`), never in the URL, so it stays out of request logs. The header link is the same capability as a query parameter, which RFC 8058 requires and mail providers POST to; that is the only place the query form is used. A GET of the header link redirects to the page; nothing changes until a POST.
- An unset or malformed `PORTAL_NOTIFICATIONS_ENABLED` is off and never takes the portal down.

## Operator notes

- Rollback: once an admin saves the new `notifications` settings field, a deployment from before this release would reject the whole settings body and fall back to defaults until rolled forward. Roll back only after removing the field, or roll forward.
- Unsubscribe links are signed with a key derived from `BETTER_AUTH_SECRET`, the deployment and the origin; rotating any of them invalidates links already sent (members can still use their email settings). The header link carries the token in a query string, which RFC 8058 requires; it can appear in request logs and only turns that kind off for that member.

## Open items that wait on Daniel

- Turning it on: set `PORTAL_NOTIFICATIONS_ENABLED=true` in Production, then turn each kind on in Congregation settings.
- Resend quota: on Resend's free plan (100 emails a day) a weekly update for every family on one day, plus sign-in links, could exceed the daily limit. Check the plan before turning weekly updates on; a paid plan is a spend decision.
