import { HINT_DISMISSED_KEY, isLoopbackOrigin, isOfflineOrigin, SEAM_KEY } from "./policy";

/**
 * Where the page is running, for the install hint and the offline runtime (§3.1, §3.9).
 * - `origin`: one of the two offline origins, torah and beitmitzvah (1.9 N24), or loopback with the test seam set (§6.2).
 *   Anywhere else (previews, aliases) the whole installable app is inert: no manifest link, no worker, no pack, no hint.
 * - `installed`: running as the installed app (display-mode standalone, or iOS's navigator.standalone).
 * - `device`: iPhone and iPad get their own steps (iPad: MacIntel with maxTouchPoints > 1, as iPadOS reports).
 */
export type Device = "iphone" | "ipad" | "android" | "other";
export type Platform = Readonly<{ origin: boolean; installed: boolean; device: Device; handheld: boolean }>;

type Env = Readonly<{
  origin: string; userAgent: string; platform: string; maxTouchPoints: number; standalone?: boolean;
  matches(query: string): boolean; seam: string | null;
}>;
export function detectPlatform(env: Env): Platform {
  const loopback = isLoopbackOrigin(env.origin), seam = loopback ? env.seam : null;
  const origin = isOfflineOrigin(env.origin) || seam === "1" || seam === "browser";
  const installed = seam === "1" || (seam !== "browser" && (env.matches("(display-mode: standalone)") || env.standalone === true));
  const ua = env.userAgent;
  const device: Device = /iPad/.test(ua) || (env.platform === "MacIntel" && env.maxTouchPoints > 1) ? "ipad"
    : /iPhone|iPod/.test(ua) ? "iphone" : /Android/.test(ua) ? "android" : "other";
  const handheld = device !== "other" || (env.matches("(pointer: coarse)") && !env.matches("(pointer: fine)") && env.maxTouchPoints > 0);
  return Object.freeze({ origin, installed, device, handheld });
}

function read(key: string): string | null { try { return window.localStorage.getItem(key); } catch { return null; } }
export function browserPlatform(): Platform {
  const nav = navigator as Navigator & { standalone?: boolean };
  return detectPlatform({ origin: location.origin, userAgent: nav.userAgent, platform: nav.platform ?? "", maxTouchPoints: nav.maxTouchPoints ?? 0,
    standalone: nav.standalone, matches: query => { try { return window.matchMedia(query).matches; } catch { return false; } }, seam: read(SEAM_KEY) });
}
export const hintDismissed = () => read(HINT_DISMISSED_KEY) === "1";
export function dismissHint() { try { window.localStorage.setItem(HINT_DISMISSED_KEY, "1"); } catch { /* It shows again next time. */ } }
