# Installed web apps on iOS and Android, late 2026 (handoff §4.1)

Written 2026-10-23. Feeds A1/A2 of `docs/superpowers/plans/2026-10-22-installable-sign-in-code-cutover.md`.

The biggest news: **iOS 27 shipped about 2026-09-14** and moved Safari's buttons again. The proposed iOS string ("tap Share, then Add to Home Screen") is wrong for most iPhones, which use the default Compact tab layout. The corrected steps are in section 1.

---

## 1. Add to Home Screen on iOS: the current steps

### What Apple's own guide says (iPhone User Guide, iOS 27 page, read 2026-10-23)

"Tap [the Page Menu button], then tap Share. If your Tabs layout is Bottom or Top, tap [the Share button]. … Scroll down the list of options, then tap Add to Home Screen. If you don't see Add to Home Screen … scroll down to the bottom of the list, tap Edit Actions, then tap Add to Home Screen. Turn on Open as Web App. Tap Add."

- **iOS 26**: the same page says "Tap [the More button], then tap Share." The More button is the three dots to the right of the address bar.
- **iOS 27**: in Compact layout the right-hand button is now Tabs. Share sits in the **Page Menu**, which is the button to the left of the address bar (Cult of Mac, June 2026; the MacStories headline is literally "Where's the Share button?").
- **Bottom or Top layout, either version**: a Share button is visible in the toolbar. Tap it directly.
- **iPad (iPadOS 27 guide)**: "tap [the Share button], tap View More, then tap Add to Home Screen. Turn on Open as Web App. Tap Add."
- **Layouts**: Settings > Apps > Safari > Tabs offers Compact (the default), Bottom and Top.

### Open as Web App matters to the plan

- Since iOS 26, every site added to the Home Screen opens as a web app by default, even without a manifest (firt.dev, updated 13 Oct 2026). The user can switch the toggle off, and then they get a plain bookmark that opens in Safari.
- With the toggle off, the plan's worker never registers, because it requires standalone mode (§3.1). Safari's 7-day storage rule also applies. The steps should say "Keep Open as Web App on."

### Recommended strings

- **iPhone:** "In Safari, tap Share, then scroll to Add to Home Screen. If you don't see Share, tap the menu button next to the address bar first. Keep Open as Web App on, then tap Add."
- **iPad:** "In Safari, tap Share, then View More, then Add to Home Screen. Keep Open as Web App on, then tap Add."
- "the menu button next to the address bar" covers both the iOS 26 More button (on the right) and the iOS 27 Page Menu (on the left) without naming an icon that will change again.
- Since iOS 16.4, Chrome and other browsers on iOS can also add web apps to the Home Screen, and the result still runs on WebKit. "In Safari" is still the right instruction, because those are the steps we have verified.

---

## 2. Storage quotas and eviction

| | iOS / iPadOS (WebKit, iOS 17+) | Android Chrome |
|---|---|---|
| Per-origin quota | About 60% of disk for a browser app. A Home Screen web app "has the same origin quota and overall quota as when it is opened in a browser app." | About 60% of disk, in best-effort and persistent modes alike |
| Overall cap | 80% of disk for browser apps | 80% of disk |
| Eviction under storage pressure | LRU by origin, all of an origin's data at once. Origins that are in persistent mode, or that have an active page, are skipped. | LRU of best-effort origins. Persistent origins are skipped. |
| Is storage shared with the browser? | No. A Home Screen app's storage is isolated from Safari. Since 17.2 the login cookies are copied into the app once, when it is installed (firt.dev). | Yes. The installed app and Chrome tabs share one origin store, so clearing Chrome's site data clears the app's data too. |
| Removing the app | Deleting the Home Screen icon deletes its storage | Uninstalling may offer to clear the data. Chrome's own data-clearing removes it. |

The plan's budget, `min(0.8 × quota, 300 MB)`, is safe on both platforms. Eviction removes everything at once (MDN, Jan 2026), which matches the plan's "index and data go together".

---

## 3. Do the caches survive 14 days unused?

**On iOS: yes for the 7-day rule, but not guaranteed against storage pressure.**

- **The 7-day rule.** ITP deletes "all cookies created in JavaScript and all other script-writeable storage after 7 days of no user interaction". That covers IndexedDB, LocalStorage, media keys, SessionStorage, and "Service Worker registrations and cache".
- **The Home Screen exemption.** WebKit's Tracking Prevention page says: "The first-party domain of home screen web applications is exempt from ITP's 7-day cap on all script-writeable storage, i.e. ITP always skips that domain in its website data removal algorithm." The 2020 post adds that Home Screen apps "have their own counter of days of use". Because those are days the app is actually used, a closed app's counter doesn't advance.
- **Display mode.** A 2021 WebKit bug (232302, WONTFIX) reported a Home Screen app losing its data after 7 days. The WebKit engineer pointed at `display: minimal-ui` and told the reporter to use `standalone`. The plan already uses `standalone`; keep it that way.
- **What is still a risk:** LRU eviction when the phone runs low on space, unless `persist()` was granted; the user deleting the icon; and a bookmark added with Open as Web App off, which falls under the 7-day rule.
- **Secondary sources that disagree.** Several 2026 blog posts (MagicBell, March 2026) still claim "7-day cache expiry" and a "50 MB cap" for PWAs. Those claims are uncited, and WebKit's primary pages contradict them. Ignore them, but test on a device.

**On Android:** there is no time-based eviction, only LRU under storage pressure.

## 4. `navigator.storage.persist()`

- **iOS / Safari 17+.** It is supported and never shows a prompt. "WebKit currently grants a request based on heuristics like whether the website is opened as a Home Screen Web App" (WebKit, Aug 2023). Persistent origins are skipped during eviction.
  - One developer report (Apple Developer Forums, Feb 2023, anecdotal) says the grant had to be requested again at each launch.
- **Chrome / Android.** It is granted automatically, with no prompt, when the site is "important": high engagement, installed or bookmarked, or notification permission. Otherwise it is silently denied, and "it can be requested again later" (web.dev).
- **For the plan:** call `navigator.storage.persisted()` on every open of the installed app, and call `persist()` again whenever it returns false. It is free and silent on both platforms. Calling it "once after the first successful pack" (§3.5) is weaker than it needs to be.

## 5. The service worker: lifetime and audio

- **Lifetime.** Browsers stop an idle worker soon after its last event and restart it for the next fetch. iOS is aggressive about this.
  - Safari has no Background Sync, Periodic Background Sync or Background Fetch (firt.dev, Oct 2026). Web Push exists only for installed apps; the plan rightly ignores it.
  - Safari 27 adds Service Worker Static Routing. The plan doesn't need it.
  - The plan runs the packer in the page and keeps the worker stateless apart from cache reads. That is the right design.
- **Cached audio offline.**
  - The plan fetches the whole clip and plays it from a `blob:` URL (§3.6), so `<audio>` never asks the worker for a byte range. That avoids the whole Range-request class of problems.
  - Historically, WebKit's media loader rejected a 200 where it expected a 206 when a service worker sat in the way (WebKit bug 184447, fixed Nov 2019). web.dev's 2020 article documents the same cross-browser hazard.
  - Keep the blob approach and the "skip any request with Range" rule.
- **Media Session and the lock screen.**
  - Media Session has been in Safari since iOS 15 (firt.dev).
  - Lock-screen controls appear only while audio is playing.
  - Background and lock-screen playback inside Home Screen web apps has been unreliable on iOS 26. A MacRumors forum thread is titled "iOS 26 Audio issues in PWA web apps (not fixed in 26.1 or 26.2, but much better)". I could only read the title, not the posts.
  - These clips are 18 seconds each and chained by script, and iOS suspends script in the background, so moving to the next clip with the screen locked is unlikely to work.
  - The plan's "make no promise in the copy" is correct. Setting `navigator.mediaSession.metadata` (title "CRC Torah", plus the verse) is cheap and harmless. Device step 4 is still needed.

## 6. Android install

- **Chrome's install criteria** (web.dev, Sept 2024):
  - not already installed;
  - the user has tapped the page at least once and spent 30 seconds on it, at any time;
  - served over HTTPS;
  - a manifest with `name` or `short_name`, 192 px and 512 px icons, `start_url`, `display` set to `standalone`, `fullscreen`, `minimal-ui` or `window-controls-overlay`, and `prefer_related_applications` absent or false.
  - A service worker is no longer required.
- **`beforeinstallprompt`** is Chromium only: Chrome, Edge and Samsung Internet. It is not Baseline (MDN). Safari doesn't support it, and neither do Firefox or `appinstalled` on iOS.
  - It fires only once the engagement rule is met, so it may not fire on a first, short visit.
  - Calling `preventDefault()` suppresses Chrome's mini-infobar (Chrome 76+).
- **Users can always install from the browser menu,** even without the event (web.dev).

## 7. Icons

- **Maskable safe zone:** keep everything important inside a centred circle whose radius is 40% of the icon's width; the outer 10% may be cropped (web.dev; W3C Manifest §2.3, Working Draft 16 Oct 2026). Fill the whole square with the lake colour, with no transparency.
- **The `purpose` field:** keep the `any` icons (192 and 512) separate from `maskable` (512). A maskable icon used as an `any` icon looks shrunken.
- **iOS:**
  - Manifest icons have been read since 15.4, but **`apple-touch-icon` overrides them when both exist**, and maskable and monochrome icons are ignored (firt.dev).
  - Use 180 × 180, opaque. A transparent touch icon is shown on black.
  - Apple's legacy guide lists 152 × 152 (iPad) and 180 × 180 (iPhone). It also says Safari looks for `/apple-touch-icon.png` at the site root when no link is present.
  - The Liquid Glass "Clear" and "Tinted" Home Screen modes re-tint web-clip icons, and a site can't control that. Shapes with strong contrast survive tinting best.

---

## 8. What this contradicts or weakens in the plan

| Plan section | Assumption | Finding | Change |
|---|---|---|---|
| §3.9 / Batch B iOS string | "In Safari, tap Share, then Add to Home Screen" is the iOS step | Wrong for the default Compact layout on iOS 26 (More, then Share) and iOS 27 (Page Menu, then Share). The iPad needs View More. | Use the strings in section 1 and keep separate iPhone and iPad lines. |
| §3.9 | iOS (including iPadOS) gets "one line of instructions" | iPhone and iPad steps differ | Two strings, chosen by `maxTouchPoints`/platform detection |
| §3.1 registration gate (standalone only) | Anyone who adds the app gets standalone mode | Only if Open as Web App stays on. With it off, the user gets a Safari bookmark: no worker, and the 7-day rule applies. | Add "Keep Open as Web App on" to the steps and to device check §6.4 step 1 |
| §3.1 manifest and touch-icon link injected by client JS | Safari and Chrome pick up a link added at runtime | Probably fine, since both read the DOM at install time, but no primary source confirms it for iOS. Safari falls back to `/apple-touch-icon.png` at the root. | Also serve `/apple-touch-icon.png` on the torah host (opaque 180 px). Verify the injected manifest on the device. |
| §3.5 | Call `persist()` once after the first pack | The grant is heuristic. The one report on iOS says it must be asked again. Chrome re-evaluates on each request. | Check `persisted()` on every open and re-request when it is false |
| §3.5 | iOS storage is "best-effort and LRU-evicted" | True, but the 7-day ITP rule does not apply to Home Screen apps in `standalone`. The 14-day window is therefore realistic on iOS, unless the phone is low on space. | None to the code. It supports the 14-day promise, with an "unless your device needs space" caveat. |
| §3.5 "Its cookies and storage are separate from Safari's, which is exactly why B is needed" | Nothing carries over from Safari | Since iOS 17.2 the login cookies are copied into the app once, at install. A user signed in in Safari before adding the app may arrive signed in. | B is still needed for every later sign-in. Add a device-check step: sign in in Safari first, then add, and note the result. |
| §3.9 Android "Install CRC Torah" button | The button appears when the hint shows | `beforeinstallprompt` needs a tap plus 30 seconds on the page. On a first visit the button may not appear. | When the event hasn't fired on Android, show a text fallback ("In Chrome, open the menu and tap Install app or Add to Home screen"). Check Chrome's exact menu label on the device. |
| §3.3 size table vs Batch B hint | "about 25 MB" | The plan's own table says 20–25 MB typical and 35–40 MB for combined parashiyot | Say "up to about 40 MB" |
| §0 / §4 ordering (A after the switch) | Nobody installs on beitmitzvah | Since iOS 26, any Home Screen add opens as a standalone web app even without a manifest. Some families may already have one for beitmitzvah. After the switch, that app redirects cross-origin and opens torah outside its scope. | No worker risk, because the gate holds. It is a UX note for the cutover message: "If you added the old address to your Home Screen, delete it and add the new one." |
| §6.4 device check | Steps 1–5 | Missing: the iOS version and Safari Tabs layout, the Open as Web App toggle, an iPad check, the cookie carry-over, and the `persisted()` result | Add these lines to PHONE-CHECK.md |
| §3.6, §3.8, §3.12 | Blob playback, separate maskable icon, no Background Sync | Confirmed | None |

---

## 9. The proposed strings, evaluated

| String | Verdict | Corrected |
|---|---|---|
| Install hint: "Install CRC Torah on this device. This week's reading and recordings stay available offline (about 25 MB)." | "about 25 MB" undercounts combined weeks. "Stay" suggests forever. On iOS the hint appears in Safari, but offline works only in the installed app. | "Install CRC Torah on this device to keep this week's reading and recordings for use offline (up to about 40 MB)." |
| iOS: "In Safari, tap Share, then Add to Home Screen." | Out of date for iOS 26 and 27 Compact; incomplete for iPad | iPhone: "In Safari, tap Share, then scroll to Add to Home Screen. If you don't see Share, tap the menu button next to the address bar first. Keep Open as Web App on, then tap Add." iPad: "In Safari, tap Share, then View More, then Add to Home Screen. Keep Open as Web App on, then tap Add." |
| Pill: "Offline · saved until {date}." | Fine. Drop the final period, since it's a label. Format the date as weekday and day ("Fri 6 Nov"), with no year. | "Offline · saved until {date}" |
| Expiry: "Saved readings last 14 days without a connection. Connect to renew them." | Inaccurate: the clock starts at the last successful online open (§3.3), not the last time the device had a connection. Being online without opening the app doesn't renew anything. It also doesn't mention that the device can remove saved readings when it is low on space. | "Saved readings stay on this device for 14 days after you last opened CRC Torah online. Open it with a connection to renew them. If the device runs low on space, it may remove them sooner." |

All of these are sentence case, with no exclamation points.

---

## Sources (primary first; dates as read 2026-10-23)

- Apple, iPhone User Guide (iOS 27), "Turn a website into an app in Safari on iPhone". The iOS 26 version of the same page was also read. Current as of 2026-10-23.
- Apple, iPhone User Guide (iOS 27), "Bookmark a website in Safari on iPhone"; "Change the layout in Safari on iPhone"; "Get started with Safari on iPhone". Current as of 2026-10-23.
- Apple, iPad User Guide (iPadOS 27), "Turn a website into an app in Safari on iPad". Current as of 2026-10-23.
- Apple, Safari Web Content Guide (archived legacy doc), "Configuring Web Applications", for touch-icon sizes and the root fallback. Undated legacy page.
- WebKit, "Updates to Storage Policy", 2023-08-10.
- WebKit, "Tracking Prevention in WebKit", for the Home Screen exemption. Live page.
- WebKit, "Full Third-Party Cookie Blocking and More", 2020-03-24, updated 2020-04-09.
- WebKit Bugzilla 232302, 2021-10-26; 184447, fixed 2019-11-05.
- MDN, "Storage quotas and eviction criteria", modified 2026-01-05.
- MDN, "Window: beforeinstallprompt event", current.
- W3C, Web Application Manifest, Working Draft 2026-10-16.
- web.dev: "What does it take to be installable?", 2024-09-19; "Installation prompt", 2022-03-09; "Persistent storage", 2020-05-12; "Adaptive icon support with maskable icons", 2019-12-19; "Handle range requests in a service worker", 2020-10-06.
- Chrome for Developers, "In Chrome 76 you can hide the Add to Home screen mini-infobar", 2019.
- firt.dev, "iOS PWA Compatibility", updated 2026-10-13. Secondary but expert and current.
- MacRumors how-to, "iOS 26: Add Web App or Bookmark to iPhone Home Screen", 2025-08-20.
- iPhone Life, tested on iOS 26.4, updated 2026-05-07.
- Glide community thread, 2025-09-25: Compact layout hides Share.
- Cult of Mac, "Safari in iOS 27: 8 new features", 2026-06-22. MacStories Weekly 517, 2026-06-14 (paywalled; headline and intro only).
- 9to5Mac, 2026-09-21: iOS 27 released the previous week.
- Apple Developer Forums thread 710157, 2022–2023, anecdotal.
- MacRumors forum thread on iOS 26 PWA audio: title only, page not readable.
- MagicBell, 2026-03-20. Cited only as an example of the uncited 7-day and 50 MB claims.
