# Public, signed-out reading — decided here

Daniel's ruling of 2026-10-22 (MISSION, "show rather than hide; alpha and beta") is the authority. Scope change the same day: Cantor Finkel's recordings are not played in the portal, so the public page has no Finkel route or player. PocketTorah is the only reference audio.

## What a visitor gets

`/read` (and a "Read this week's Torah and haftarah" link on the home and sign-in page) shows any Shabbat's full parashah and its haftarah. It has Hebrew with trope, the JPS 2023 English, the tikkun view, colours, word tools (syllables and stress, meaning, grammar, "this word elsewhere"), "view up close" with phrase names, the trope chart link, and PocketTorah verse and word playback. "Sign in" stays in the app bar and in a card under the reading.

## Decided here

- **Browsing is by Shabbat.** Use previous week, next week, this week or a date picker. The date picker snaps to the Saturday on or after the chosen date. The window is two years back and three years ahead. There is no static list of all 54 parashot, so every parashah is reached by its date. A parashah index would need its own calendar source, and it can come later if Daniel wants it.
- **The passage is the same as the student's proposed portion.**
  - Torah is the full parashah from the same Hebcal calendar code (`proposeReading` with `full`).
  - Haftarah is the passage Hebcal lists for that Shabbat, so special-Shabbat haftarot come through as they do for students.
  - Festival and ambiguous weeks show the haftarah only (or nothing). They never show an invented Torah range.
  - The calendar is CRC's diaspora custom, fixed in code (the seed in migration 0002). This avoids reading a tenant row.
- **The server never accepts a caller-supplied range.** Every public request names a Saturday, a kind and small bounded numbers. The passage always comes from the calendar. One canonical URL exists per resource: the keys are closed, the order is fixed and nothing extra is allowed. This bounds the set of distinct public URLs, and so bounds the uncached server work.
- **Separate runtime.** The public routes run in `composePublicRuntime`, which has no auth stack and no access, student or mail services. It touches only:
  - `tenant_host` (the exact host map, which must be CRC);
  - the two global, non-tenant public caches that the signed-in reading already fills (`hebcal_cache` and `sefaria_text_cache`).
  - A test records every SQL statement it issues, running as the restricted runtime role.
- **PocketTorah stays behind its switches.** Visitors never hear more than students. Public verse metadata needs both `REFERENCE_AUDIO_STUDENT_RELEASE=true` and `REFERENCE_AUDIO_SHORT_PUBLIC_RELEASE=true`. The bytes stay on the existing content-addressed `/reference-audio/short-v1/<sha256>.mp3` route (immutable caching, unchanged). No new audio route exists.
- **Generated chant has no path.** No public module imports the trope engine or any render code, and a test checks this.
- **Noindex until beta:**
  - an `X-Robots-Tag: noindex, nofollow` header on every route (next.config, and set again by the public API itself);
  - the robots meta on the root layout and on `/read`;
  - `/robots.txt` disallowing everything.
  - Because robots.txt blocks crawling, a crawler never reads the meta or the header. That is what was asked for; together they keep the pages out of search.
- **Caching:**
  - Public JSON is `public, max-age=300` in the browser and `s-maxage=86400` at the CDN (the week summary is cached for one hour).
  - Errors are `no-store`.
  - `/read` is a static page served by the CDN. The browser picks this week's Shabbat in America/Chicago.

## Spend (Daniel's ceiling: $10 a month for the whole portal)

Expected added cost is under $1 a month at alpha traffic, and most likely $0 beyond the existing plan:

- The page is static, so no function runs to serve it.
- Each distinct JSON URL costs at most one function invocation a day per CDN region. Each invocation makes about three to six small Neon queries and, rarely, one Sefaria or Hebcal fetch.
- Audio is served from the existing immutable short route, so each clip is read from Blob about once per region.

The one heavy cost is word details. The lexical (STEP) source keeps one book per server instance, and changing book re-downloads and re-parses an 18–25 MB file, about two seconds of CPU. The second-agent audit found this. Containment:

- Signed-out traffic has its own loader instance, so it never evicts a student's book.
- It gets a budget of four book changes per minute per instance. Past the budget, word details answer 503 and the response is not cached.
- A momentary lexical or "elsewhere" miss is always a 503 that nothing caches, never a cached "unavailable".
- Authorization and Range headers are refused, so every answer stays CDN-cacheable.
- Bad dates, kinds and numbers are refused before the database opens.

Worst case:

- The URL space is about 261 Saturdays × two kinds × (a few text and audio pages + about 150 verses × (1 + words per verse) word-tool URLs), on the order of a million URLs.
- Under a deliberate, sustained crawl, the budget caps STEP work at about 8 CPU-seconds a minute per busy instance. That is about 3.2 CPU-hours, roughly $0.40, a day per instance, and an attacker can spread the load across instances. Several busy instances kept up for weeks could pass the $10 ceiling, so this is a cap rather than a guarantee. Ordinary alpha traffic should cost nothing measurable.
- **For Daniel before this is deployed:** approve a Vercel Firewall rate limit on `/api/public/`, or accept the uncapped worst case. This sits at the spend gate, because the worst case could cross $10 a month.
- Not done, because it is shared signed-in code: keying the STEP cache by source file rather than by book. That would stop ordinary browsing across Torah books from reloading the same file.
- The real limit on abuse is a Vercel Firewall rate limit on `/api/public/`, for example 120 requests a minute per IP. That is a configuration change for Daniel and is not part of this change.
