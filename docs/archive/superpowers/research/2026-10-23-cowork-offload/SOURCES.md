# Sources

Merged on 2026-10-23 from `research/SOURCES-pwa.md`, `research/SOURCES-codes.md` and `research/SOURCES-drill-sefaria.md`. The originals are left in place. One section per report. All sources were read on 2026-10-23 unless a line says otherwise.

---

## 1. Installed web apps on iOS and Android (`research/pwa-offline.md`)

Each source with its URL and its date. "Read" means read on 2026-10-23.

### Apple (primary)

- Apple, iPhone User Guide, iOS 27, "Turn a website into an app in Safari on iPhone". https://support.apple.com/guide/iphone/open-as-web-app-iphea86e5236/ios. Current iOS 27 page, read 2026-10-23.
  - iOS 26 version of the same page: https://support.apple.com/guide/iphone/iphea86e5236/26.0/ios/26.0. Read 2026-10-23.
- Apple, iPhone User Guide, iOS 27, "Bookmark a website in Safari on iPhone". https://support.apple.com/guide/iphone/bookmark-a-website-iph42ab2f3a7/ios. Read 2026-10-23.
- Apple, iPhone User Guide, iOS 27, "Change the layout in Safari on iPhone". https://support.apple.com/guide/iphone/change-the-layout-ipha9ffea1a3/27/ios/27. Read 2026-10-23.
- Apple, iPhone User Guide, iOS 27, "Get started with Safari on iPhone". https://support.apple.com/guide/iphone/get-started-with-safari-iph7384445c6/ios. Read 2026-10-23.
- Apple, iPad User Guide, iPadOS 27, "Turn a website into an app in Safari on iPad". https://support.apple.com/guide/ipad/open-as-web-app-ipad8f1f7a29/ipados. Read 2026-10-23.
- Apple, Safari Web Content Guide, "Configuring Web Applications". https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html. Legacy page, undated.

### WebKit (primary)

- WebKit, "Updates to Storage Policy". https://webkit.org/?p=14403. 2023-08-10.
- WebKit, "Tracking Prevention in WebKit". https://webkit.org/tracking-prevention/. Live page, read 2026-10-23.
- WebKit, "Full Third-Party Cookie Blocking and More". https://webkit.org/?p=10218. 2020-03-24, updated 2020-04-09.
- WebKit Bugzilla 232302, "Service worker and storage deleted after 7 days on Web application added to Home Screen". https://bugs.webkit.org/show_bug.cgi?id=232302. 2021-10-26.
- WebKit Bugzilla 184447, "mp4 video element broken with service worker". https://bugs.webkit.org/show_bug.cgi?id=184447. Fixed 2019-11-05.

### MDN, W3C, web.dev and Chrome (primary)

- MDN, "Storage quotas and eviction criteria". https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria. Modified 2026-01-05.
- MDN, "Window: beforeinstallprompt event". https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeinstallprompt_event. Read 2026-10-23.
- W3C, Web Application Manifest. https://www.w3.org/TR/appmanifest/. Working Draft 2026-10-16.
- web.dev, "What does it take to be installable?". https://web.dev/articles/install-criteria. 2024-09-19.
- web.dev, "Installation prompt". https://web.dev/learn/pwa/installation-prompt. 2022-03-09.
- web.dev, "Persistent storage". https://web.dev/articles/persistent-storage. 2020-05-12.
- web.dev, "Adaptive icon support with maskable icons". https://web.dev/articles/maskable-icon. 2019-12-19.
- web.dev, "Handle range requests in a service worker". https://web.dev/articles/sw-range-requests. 2020-10-06.
- Chrome for Developers, "In Chrome 76 you can hide the Add to Home screen mini-infobar". https://developer.chrome.com/blog/mini-infobar-update/. 2019.

### Secondary

- firt.dev, "iOS PWA Compatibility". https://firt.dev/notes/pwa-ios/. Updated 2026-10-13.
- MacRumors, "iOS 26: Add Web App or Bookmark to iPhone Home Screen". https://www.macrumors.com/how-to/save-safari-bookmark-web-app-iphone-home-screen/. 2025-08-20.
- iPhone Life, "How to Add a Website to Your Home Screen on iPhone & iPad". https://iphonelife.com/content/tip-day-turn-your-favorite-website-home-screen-icon. Updated 2026-05-07; tested on iOS 26.4.
- Glide community, "iOS 26 Add to Home Screen Workflow Change". https://community.glideapps.com/t/ios-26-add-to-home-screen-workflow-change/84599. 2025-09-25.
- Apple Community thread 256238253. https://discussions.apple.com/thread/256238253. 2026-02-04.
- Cult of Mac, "Safari in iOS 27: 8 new features that make browsing better". https://www.cultofmac.com/news/safari-features-ios-27. 2026-06-22.
- MacStories Weekly 517, "Safari for iOS 27: Where's the Share Button?". https://www.macstories.net/club/macstories-weekly-issue-517/safari-for-ios-27-wheres-the-share-button/. 2026-06-14. Paywalled; intro only.
- 9to5Mac, "iOS 27 adds an all-new app to your iPhone's Home Screen". https://9to5mac.com/2026/09/21/ios-27-adds-an-all-new-app-to-your-iphones-home-screen/. 2026-09-21; confirms the iOS 27 release date.
- Apple Developer Forums 710157, "Safari iOS PWA Data Persistence Beyond 7 Days". https://developer.apple.com/forums/thread/710157. 2022-2023; anecdotal.
- MacRumors Forums, "iOS 26 Audio issues in PWA web apps (not fixed in 26.1 or 26.2, but much better)". https://forums.macrumors.com/threads/ios-26-audio-issues-in-pwa-web-apps-not-fixed-in-26-1-or-26-2-but-much-better.2466839/. Undated; title only, page not readable.
- MagicBell, "PWA iOS Limitations and Safari Support [2026]". https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide. 2026-03-20. Cited only as an example of uncited, contradicted claims.

---

## 2. Sign-in codes in email (`research/sign-in-codes.md`)

Read 2026-10-23.

### Primary

- NIST SP 800-63B (63-3 text), out-of-band and look-up secrets, https://pages.nist.gov/800-63-3/sp800-63b.html. Published 2017, revised 2020. Newer SP 800-63B-4 exists; not read.
- OWASP Multifactor Authentication Cheat Sheet, https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html. Living document, current as fetched.
- MDN, autocomplete attribute (one-time-code), https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/autocomplete. Living document.
- W3C WICG, WebOTP API, https://wicg.github.io/web-otp/. Draft Community Group Report, 13 April 2021. Not a standard.
- W3C WICG, Origin-bound one-time codes delivered via SMS, https://wicg.github.io/sms-one-time-codes/. Draft, 24 March 2021. SMS only.
- Apple Support, Safari on Mac, SMS passcodes, https://support.apple.com/guide/safari/ibrwa4a6c6c6/mac. Messages only; Mail not mentioned.
- Apple Developer Forums, "Autofill verification codes received in Mail", https://developer.apple.com/forums/thread/738690. Started Nov 2023. Only Apple reply asks for Feedback with an .eml. No documented rule.

### Secondary (less authoritative)

- Techlicious, Safari autofills codes from Mail and Messages, 1 Nov 2023, https://www.techlicious.com/blog/effortless-logins-safaris-new-feature-auto-fills-verification-codes/
- OS X Daily, autofill security codes from Mail, 14 Feb 2024, https://osxdaily.com/2024/02/14/how-autofill-security-code-mail-iphone-ipad-mac/ (iOS 17 / macOS 14 or newer; account set up in Mail).
- Android Central, Gmail Copy Code button, 21 Sept 2026, https://www.androidcentral.com/apps-software/gmail/gmail-for-android-now-finds-your-verification-codes
- Macworld, why Apple SMS codes end in "@apple.com #123456" (SMS, not email), https://www.macworld.com/article/606996/apple-verification-code.html (seen in search results; not opened).

### Not found

- No Apple or Google document stating the detection rule for emailed codes, or Home Screen web app behavior for it.
- 1Password community thread (14 Sept 2026) on PWA login autofill is about password filling, not codes; not used.

---

## 3. The translate drill and Sefaria as an upstream (`research/translate-drill.md`, `research/sefaria-upstream.md`, `SEFARIA-NOTE.md`)

All sources were consulted on 2026-10-23. Publication or update dates are given where the page shows them.

### The translate drill

| Source | Date | Used for |
|---|---|---|
| Gershom Tave, "Building Tanakh Skills One Step at a Time With Manipulative Materials", *Jewish Educational Leadership* (Lookstein Center), https://lookstein.org/?p=270628 | 2025-01-07 | Scaffolds: roots, prefix and suffix cards, word-by-word verse work |
| *Biblical Hebrew Translation, Grammar and Meaning Workbook* (4th grade), hosted by Brandeis, https://www.brandeis.edu/scroll/translation-grammar-meaning-workbook.pdf | No date shown | Scaffolds: roots first, colour-coded affixes, bracketed added words |
| *Fundamentals of Court Interpretation: Sight Translation Exercises* (Agnese Haury Institute, 1991), Judicial Council of California, https://languageaccess.courts.ca.gov/system/files/2025-10/sightransexercises.pdf | Posted 2025-10 | Sight translation drills: reading ahead, chunking, reading aloud |
| Seabrooke, Mitchell, Wills, Inkster, Hollins et al., "The benefits of impossible tests: Assessing the role of error-correction in the pretesting effect", *Memory & Cognition* 50, https://link.springer.com/article/10.3758/s13421-021-01218-6 | Online 2021-08-06; issue 2022 | Guessing a translation, then seeing it, improves later memory, even when the guess is wrong |
| Anki manual, "Studying", https://docs.ankiweb.net/manual/studying | Current docs | The counter-model: reveal, then grade yourself (Again, Hard, Good, Easy) |
| Pimsleur, "The Pimsleur Method", https://www.pimsleur.com/the_pimsleur_method | Current page | Anticipation: prompt, pause, response, then reinforcement, with no grade |
| *A Reader's Hebrew Bible* (Brown and Smith, Zondervan), publisher's listing and reviews, https://www.thegospelcoalition.org/themelios/review/a-readers-hebrew-bible/ | Search results only; page not read | Rare-word glosses as a reading scaffold. Background only: the exact frequency threshold is not confirmed here. |
| Repo: `docs/superpowers/specs/2026-10-22-leyning-platform-design.md` sections 3.2-3.4; `docs/superpowers/plans/2026-10-22-accounts-1-4.md` section 5 "Study (PR 3)"; `DESIGN.md`; `PRODUCT.md` | 2026-10-22 | The drill's spec and planned behaviour, and the tone and design rules |

### Sefaria as an upstream

| Source | Date | Used for |
|---|---|---|
| Sefaria Terms of Use, https://www.sefaria.org/terms (the embedded Google Doc) | Last updated 2026-04-15 | Crawling ban (section 3); no commercial use (section 3); no abusive or burdensome automated use (section 5); trademarks; attribution by hyperlink (section 4) |
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
