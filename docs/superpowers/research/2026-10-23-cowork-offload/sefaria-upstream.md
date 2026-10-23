# Sefaria as an upstream: terms, load, credit and a courtesy note

2026-10-23. This covers handoff §4.4. Sources with dates are in `SOURCES-drill-sefaria.md`.

## Findings

1. **We need no key or sign-up, and Sefaria publishes no rate limit.**
   - Sefaria's developer docs say every documented endpoint works "without API keys, tokens, or authorization".
   - Neither the developer portal nor the Terms of Use states a request-per-second figure. Checked 2026-10-23; the copyright page was updated 2026-10-20.
   - The terms instead ban use that is "abusive or disruptive", and use that places "a burden on the Service or the networks or servers connected with the Service" (Terms of Use §5, last updated 2026-04-15).
2. **Crawling is banned. On-demand reading is not.**
   - The terms ban "data mining, screen-scraping, robots, or similar data gathering and extraction systems whose primary purpose is simply to crawl the Service for its Content" (§3). For bulk data they point to their GitHub export instead.
   - Our traffic is different: one request when a person opens a reading, coalesced, at most two chapters at a time (`STUDY_LIMITS.concurrency: 2` in `src/server/study/sefaria.ts`), then cached for 30 days, a week or an hour.
   - **One thing to avoid:** a script that warms the cache by walking whole books or every parashah would look like a crawl. If bulk text is ever wanted, use Sefaria-Export. It is rebuilt monthly in public Google Cloud Storage buckets, according to the developer newsletter of April 2026.
3. **Commercial use is banned. CRC's use is not commercial.** The terms say "any exploitation of the Service or its Content for any commercial use is strictly prohibited."
   - CRC Torah is free, nonprofit and educational, so this fits.
   - It matters for 2.0: a second congregation is fine, but any paid tier or fee for congregations would need a fresh look at these terms first.
4. **Credit works at two levels.**
   - **Each text version carries its own licence.** Each language counts as its own edition. The app's current credit already does what CC BY and CC BY-SA ask: the edition, the licence, and "via Sefaria" with a link (spec §4 and §5). The terms' reuse section asks for a hyperlink to the page reused, "where possible".
   - **The links dataset is CC BY.** That dataset is what "More on this verse" and the shelf counts are built from. Its licence asks for three things: credit Sefaria as the source, link to the licence, and note any changes.
     - This is the one gap I can see.
     - The shelf should carry a line at its foot, for example "Connections via Sefaria · CC BY".
     - If the curation filters or reorders the links, add "selected and ordered by CRC Torah". Claude Code should check what the shelf shows now.
5. **The name is a trademark; the logo needs permission.** Using Sefaria's logos needs "express, prior written consent". Sefaria offers two "Powered by Sefaria" graphics for open use. A plain text credit ("via Sefaria") is fine, and it is what we use. Don't add their logo unless it is one of those two graphics.
6. **Sefaria asks projects to tell them, but doesn't require it.**
   - The developer newsletter says "if you haven't told us about your Powered by Sefaria project yet, please do". The Powered by page says "Tell us about it".
   - There are three ways in:
     - an engineering contact form, for technical questions;
     - Sefaria's public contact address, for general questions;
     - a Powered by Sefaria submission form, for the public showcase.
   - The showcase is curated, at Sefaria's discretion, and listing is not automatic.
   - Comparable projects (AlHaTorah, AllDaf, Hadran, Dicta) are listed there. Nothing I found says they wrote first, so how common a note is can't be confirmed. It is clearly welcome, though.
7. **Our requests don't identify us.** The chapter fetch in `src/server/study/sefaria.ts` sends only `accept: application/json`, with no User-Agent naming the site. I checked only this file; the commentary and links fetchers may do the same.
   - Sefaria doesn't ask for a User-Agent. Sending one is ordinary courtesy for an API consumer, and it lets them reach us instead of blocking an unknown Vercel IP range.
   - Suggested value: `CRC-Torah/1.4 (+https://torah.centralreform.org)`. It names no person and adds no new address.

## Recommendation

Daniel decided on 2026-10-23 not to send the courtesy note (QUESTIONS E3). The first bullet below is kept as written but is not being acted on.

- **Send a short courtesy note through the engineering contact form** (not the showcase form). Draft: `SEFARIA-NOTE.md`.
  - It costs nothing.
  - It tells them who the steady trickle from Vercel is.
  - It asks the one question the docs don't answer: what pacing they would like.
- **Hold the Powered by Sefaria submission** until Daniel wants the site public. Pages are noindex, and the showcase is a public listing.
- **For Claude Code** (not blocking):
  1. Add the identifying User-Agent to every Sefaria fetch.
  2. Add the links-dataset credit line to the shelf.
  3. Never add a bulk pre-warm job.
  4. On a 429 or 5xx from Sefaria, serve the cached copy if there is one, and don't retry in a loop. Today a non-200 becomes `invalid-response`; check that this path never retries.

## Contradictions with the plans

None found. One point is worth adding to spec §5, so the credit rule covers the shelf as well as the opened texts: the links behind "More on this verse" are CC BY, and that is a separate credit from each text's own licence.
