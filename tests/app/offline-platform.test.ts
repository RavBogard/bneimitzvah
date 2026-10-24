import { expect, test } from "vitest";
import { detectPlatform } from "../../src/lib/offline/platform";
import { NEW, PLAN } from "../../src/lib/offline/copy";

// Where the installable app is live, and Daniel's exact wording (1.5 plan, 2026-10-23 rulings B4, F3, popup rulings).
const base = { userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 7) Chrome/140 Mobile", platform: "Linux armv8l", maxTouchPoints: 5, matches: () => false, seam: null };

test("only the torah origin, or loopback with the seam, is live; beitmitzvah, aliases and previews are inert, and the seam is ignored there", () => {
  expect(detectPlatform({ ...base, origin: "https://torah.centralreform.org" }).origin).toBe(true);
  for (const origin of ["https://beitmitzvah.centralreform.org", "https://bneimitzvah.vercel.app", "https://bneimitzvah-git-x.vercel.app", "http://127.0.0.1:3100", "http://torah.centralreform.org"]) {
    expect(detectPlatform({ ...base, origin }).origin, origin).toBe(false);
  }
  for (const seam of ["1", "browser"]) {
    expect(detectPlatform({ ...base, origin: "https://beitmitzvah.centralreform.org", seam })).toMatchObject({ origin: false, installed: false });
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
  for (const value of [...Object.values(PLAN), ...Object.values(NEW)]) {
    const text = typeof value === "function" ? value("CRC Torah") : value;
    expect(text, text).not.toMatch(/!|\bawesome\b|\byay\b/i);
  }
});
