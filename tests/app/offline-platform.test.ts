import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { detectPlatform } from "../../src/lib/offline/platform";
import { APPROVED, NEW, PLAN } from "../../src/lib/offline/copy";
import { isOfflineOrigin, OFFLINE_ORIGINS } from "../../src/lib/offline/policy";
import { OfflineShelfView } from "../../src/components/portal/offline/shelf";

// Where the installable app is live, and Daniel's exact wording (1.5 plan, 2026-10-23 rulings B4, F3, popup rulings).
const base = { userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 7) Chrome/140 Mobile", platform: "Linux armv8l", maxTouchPoints: 5, matches: () => false, seam: null };

test("the torah and beitmitzvah origins (N24, decision 14), or loopback with the seam, are live; aliases and previews are inert, and the seam is ignored there", () => {
  expect(OFFLINE_ORIGINS).toEqual(["https://torah.centralreform.org", "https://beitmitzvah.centralreform.org"]);
  for (const origin of OFFLINE_ORIGINS) expect(detectPlatform({ ...base, origin }).origin, origin).toBe(true);
  // Whole-origin matches only: no other scheme, port, suffix, prefix, case or trailing slash.
  for (const origin of ["https://bneimitzvah.vercel.app", "https://bneimitzvah-git-x.vercel.app", "https://bneimitzvah.centralreform.org", "https://barmitzvah.centralreform.org", "http://127.0.0.1:3100",
    "http://torah.centralreform.org", "http://beitmitzvah.centralreform.org", "https://beitmitzvah.centralreform.org:8443", "https://beitmitzvah.centralreform.org.evil.test",
    "https://evil-beitmitzvah.centralreform.org", "https://BEITMITZVAH.centralreform.org", "https://beitmitzvah.centralreform.org/", "https://centralreform.org"]) {
    expect(detectPlatform({ ...base, origin }).origin, origin).toBe(false);
    expect(isOfflineOrigin(origin), origin).toBe(false);
  }
  for (const seam of ["1", "browser"]) {
    expect(detectPlatform({ ...base, origin: "https://bneimitzvah.vercel.app", seam })).toMatchObject({ origin: false, installed: false });
    expect(detectPlatform({ ...base, origin: "http://127.0.0.1:3187", seam }).origin).toBe(true);
  }
  expect(detectPlatform({ ...base, origin: "http://127.0.0.1:3187", seam: "1" }).installed).toBe(true);
  expect(detectPlatform({ ...base, origin: "http://127.0.0.1:3187", seam: "browser", matches: () => true }).installed).toBe(false);
});

test("installed means standalone display or iOS's navigator.standalone", () => {
  const torah = { ...base, origin: "https://torah.centralreform.org" };
  expect(detectPlatform(torah).installed).toBe(false);
  expect(detectPlatform({ ...torah, matches: (query: string) => query === "(display-mode: standalone)" }).installed).toBe(true);
  expect(detectPlatform({ ...torah, standalone: true }).installed).toBe(true);
});

test("iPhone and iPad are told apart (iPadOS reports MacIntel with touch points); phones and tablets are handheld, desktops are not", () => {
  const torah = { ...base, origin: "https://torah.centralreform.org" };
  expect(detectPlatform({ ...torah, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X)", platform: "iPhone" })).toMatchObject({ device: "iphone", handheld: true });
  expect(detectPlatform({ ...torah, userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 5 })).toMatchObject({ device: "ipad", handheld: true });
  expect(detectPlatform({ ...torah, userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 0, matches: (q: string) => q === "(pointer: fine)" })).toMatchObject({ device: "other", handheld: false });
  expect(detectPlatform(torah)).toMatchObject({ device: "android", handheld: true });
});

test("the strings are Daniel's, verbatim, with the congregation's productName", () => {
  expect(PLAN.installHint("CRC Torah")).toBe("Install CRC Torah on this device to keep this week’s reading and recordings for use offline (up to about 40 MB).");
  expect(PLAN.iphoneSteps).toBe("In Safari, tap Share, then scroll to Add to Home Screen. If you don’t see Share, tap the menu button next to the address bar first. Keep Open as Web App on, then tap Add.");
  expect(PLAN.ipadSteps).toBe("In Safari, tap Share, then View More, then Add to Home Screen. Keep Open as Web App on, then tap Add.");
  expect(PLAN.androidMenu).toBe("In Chrome, open the menu and tap Install app or Add to Home screen.");
  expect(PLAN.pill("Fri 6 Nov")).toBe("Offline · saved until Fri 6 Nov");
  expect(PLAN.expiry("Synthetic Torah")).toBe("Saved readings stay on this device for 14 days after you last opened Synthetic Torah online. Open it with a connection to renew them. If the device runs low on space, it may remove them sooner.");
  for (const value of [...Object.values(PLAN), ...Object.values(APPROVED), ...Object.values(NEW)]) {
    const text = typeof value === "function" ? value("CRC Torah") : value;
    expect(text, text).not.toMatch(/!|\bawesome\b|\byay\b/i);
  }
});

test("/offline is never empty (D20): its heading always, and the approved empty line wherever nothing is saved", () => {
  const view = (live: boolean | null, packs: [] | null, removed = false) => renderToStaticMarkup(createElement(OfflineShelfView, { live, packs, removed, productName: null, onRemove: () => {} }));
  const heading = /<h1[^>]*>Saved on this device<\/h1>/, empty = /data-testid="offline-empty"[^>]*>Nothing is saved on this device yet\.</;
  // Before the platform is known (the server render, so the installed shell's copy): the heading.
  expect(view(null, null)).toMatch(heading);
  // A host that keeps nothing (a preview or an alias), and an offline origin with nothing saved: the heading and the line.
  for (const markup of [view(false, null), view(true, [])]) { expect(markup).toMatch(heading); expect(markup).toMatch(empty); }
  expect(view(true, [], true)).toContain(APPROVED.removed);
  // No Remove button when there is nothing to remove.
  expect(view(true, [])).not.toContain(PLAN.remove);
});

test("sign-out removes the saved readings before the session goes, on whichever origin it runs (shared devices)", () => {
  // Both Sign outs (the front door's and Account's) go through the one helper, which purges first.
  const helper = readFileSync("src/components/portal/sign-out.ts", "utf8");
  expect(helper.indexOf("await purgeOffline();")).toBeGreaterThan(0);
  expect(helper.indexOf("await purgeOffline();")).toBeLessThan(helper.indexOf('"/api/auth/sign-out"'));
  expect(readFileSync("src/components/portal/entry.tsx", "utf8")).toContain("await signOutOfPortal();");
  expect(readFileSync("src/components/portal/account-page.tsx", "utf8")).toContain("await signOutOfPortal();");
});
