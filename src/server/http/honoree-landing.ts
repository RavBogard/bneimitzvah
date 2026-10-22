import "server-only";
import { createHash } from "node:crypto";
import { errorResponse, HttpBoundaryError, privateHeaders } from "./responses";

// This document intentionally bypasses React and Next hydration. Neither the
// fragment nor the delivered reading becomes a server render or resource URL.
const script = String.raw`(() => {
"use strict";
let token = "";
try {
  const fragment = location.hash, query = location.search;
  history.replaceState(null, "", location.pathname);
  if (!query && /^#token=hl1\.k1\.[A-Za-z0-9_-]{21}[AQgw]\.[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]\.[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(fragment)) token = fragment.slice(7);
} catch { token = ""; }
let active = true, controller, reader, expiryTimer, requestTimer, deadline = 0, ended = "";
// The first cause decides the wording only. Leaving the page (an app or tab switch) is told apart from
// a link that could not be opened; neither says why a link was refused, and both clear the same way.
const unavailable = cause => {
  if (!ended) ended = cause === "away" ? "away" : "refused";
  active = false; token = ""; deadline = 0;
  controller?.abort(); void reader?.cancel().catch(() => {});
  clearTimeout(expiryTimer); clearTimeout(requestTimer);
  const content = document.getElementById("reading");
  if (content) { content.hidden = true; content.replaceChildren(); }
  const heading = document.getElementById("heading"), status = document.getElementById("status");
  if (heading) heading.textContent = ended === "away" ? "Your blessings were closed for privacy" : "This invitation is unavailable";
  if (status) { status.hidden = false; status.textContent = ended === "away" ? "This page closes the blessings whenever you switch to another app or tab. That doesn’t cancel your invitation. To read them again, open the original invitation link again. If it doesn’t open, ask the person who sent it for a new link." : "Reopen the original invitation. If it is still unavailable, ask the person who sent it for a new link."; }
};
const away = () => unavailable("away");
window.addEventListener("pagehide", away);
window.addEventListener("beforeunload", away);
window.addEventListener("pageshow", event => { if (event.persisted) away(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState !== "visible") away(); });
document.addEventListener("freeze", away);
const closed = (value, keys) => {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join() !== keys.slice().sort().join()) throw 0;
  return value;
};
const text = (value, max) => {
  if (typeof value !== "string" || !value.length || value.length > max || !value.isWellFormed() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw 0;
  return value;
};
const civilDate = value => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw 0;
  const date = new Date(value + "T00:00:00.000Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw 0;
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
};
const validate = value => {
  const v = closed(value, ["ok", "schemaVersion", "student", "aliyah", "material", "expiresAt"]);
  if (v.ok !== true || v.schemaVersion !== 1) throw 0;
  closed(v.student, ["firstName", "ceremonyDate"]); text(v.student.firstName, 256); civilDate(v.student.ceremonyDate);
  closed(v.aliyah, ["startVerse", "endVerse"]);
  for (const verse of [v.aliyah.startVerse, v.aliyah.endVerse]) if (!/^[A-Za-z0-9 ]+ [1-9][0-9]*:[1-9][0-9]*$/.test(text(verse, 80))) throw 0;
  const m = closed(v.material, ["version", "before", "after", "credits"]); text(m.version, 128);
  for (const blocks of [m.before, m.after]) {
    if (!Array.isArray(blocks) || blocks.length < 1 || blocks.length > 64) throw 0;
    for (const block of blocks) { closed(block, ["he", "en"]); text(block.he, 8192); text(block.en, 8192); }
  }
  if (!Array.isArray(m.credits) || m.credits.length < 1 || m.credits.length > 32) throw 0;
  for (const credit of m.credits) text(credit, 4096);
  if (new TextEncoder().encode(JSON.stringify(m)).byteLength > 65536) throw 0;
  if (typeof v.expiresAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v.expiresAt) || new Date(v.expiresAt).toISOString() !== v.expiresAt) throw 0;
  return v;
};
const node = (tag, value, lang) => {
  const el = document.createElement(tag); el.textContent = value;
  if (lang) { el.lang = lang; el.dir = lang === "he" ? "rtl" : "auto"; }
  return el;
};
const remaining = () => deadline - performance.now();
const armExpiry = () => {
  const left = remaining();
  if (!active || !Number.isFinite(left) || left <= 0) { unavailable(); return; }
  expiryTimer = setTimeout(armExpiry, Math.min(left, 60000));
};
const render = v => {
  const content = document.getElementById("reading"), fragment = document.createDocumentFragment();
  const context = node("p", ""); context.className = "context";
  const name = node("bdi", v.student.firstName); name.dir = "auto";
  context.append(name, document.createTextNode(" · " + civilDate(v.student.ceremonyDate)));
  const span = node("p", ""); span.className = "span";
  const reference = node("bdi", v.aliyah.startVerse === v.aliyah.endVerse ? v.aliyah.startVerse : v.aliyah.startVerse + " – " + v.aliyah.endVerse); reference.dir = "ltr";
  span.append(reference); fragment.append(context, span);
  for (const [label, blocks] of [["Before the reading", v.material.before], ["After the reading", v.material.after]]) {
    const section = document.createElement("section"), heading = node("h2", label);
    section.append(heading);
    for (const block of blocks) {
      const he = node("p", block.he, "he"), en = node("p", block.en, "en");
      he.className = "hebrew"; en.className = "english"; section.append(he, en);
    }
    fragment.append(section);
  }
  const credits = document.createElement("footer"); credits.className = "credits";
  credits.append(node("h2", "About this text"));
  for (const credit of v.material.credits) credits.append(node("p", credit, "en"));
  // Informational only: the remaining-life header/monotonic deadline above
  // supplies authority. This civil display never authorizes or extends access.
  const availableUntil = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZoneName: undefined }).format(new Date(v.expiresAt));
  const expiry = node("p", "Available until " + availableUntil); expiry.className = "availability"; credits.append(expiry);
  fragment.append(credits);
  // Check again after building detached nodes; no late result can restore text.
  const left = remaining();
  if (!active || document.visibilityState !== "visible" || !Number.isFinite(left) || left <= 0) throw 0;
  content.replaceChildren(fragment); content.hidden = false;
  document.getElementById("heading").textContent = "Your aliyah blessings";
  document.getElementById("status").hidden = true;
};
document.addEventListener("DOMContentLoaded", async () => {
  if (!active || !token || document.visibilityState !== "visible") { unavailable(); return; }
  controller = new AbortController(); requestTimer = setTimeout(unavailable, 12000);
  try {
    const started = performance.now();
    const pending = fetch("/api/honoree/read", { method: "POST", credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer", signal: controller.signal,
      headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ token }) });
    token = "";
    const response = await pending;
    if (!active || !response.ok || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(response.headers.get("content-type") || "")) throw 0;
    const life = response.headers.get("X-Honoree-Remaining-Ms");
    if (!/^[1-9][0-9]{0,9}$/.test(life || "")) throw 0;
    const milliseconds = Number(life);
    if (!Number.isSafeInteger(milliseconds) || milliseconds > 7776000000) throw 0;
    reader = response.body?.getReader(); if (!reader) throw 0;
    let serialized = "", bytes = 0; const decoder = new TextDecoder("utf-8", { fatal: true });
    try {
      while (true) {
        const chunk = await reader.read(); if (!active) throw 0; if (chunk.done) break;
        bytes += chunk.value.byteLength; if (bytes > 98304) throw 0;
        serialized += decoder.decode(chunk.value, { stream: true });
      }
      serialized += decoder.decode();
    } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); reader = undefined; }
    const value = validate(JSON.parse(serialized)); serialized = "";
    const now = performance.now();
    if (!active || !Number.isFinite(started) || !Number.isFinite(now) || now < started || milliseconds - (now - started) <= 0) throw 0;
    deadline = started + milliseconds;
    render(value); clearTimeout(requestTimer); armExpiry();
  } catch { unavailable(); }
  finally { token = ""; clearTimeout(requestTimer); }
});
})();`;

const style = `@font-face{font-family:Bricolage;src:url('/fonts/bricolage-grotesque/BricolageGrotesque.ttf') format('truetype');font-weight:200 800;font-display:swap}@font-face{font-family:Hebrew;src:url('/fonts/noto-serif-hebrew/NotoSerifHebrew.ttf') format('truetype');font-weight:100 900;font-display:swap}*{box-sizing:border-box}html{color-scheme:light dark;--canvas:#ebf2fa;--ink:#13202f;--muted:#4b5a6b;--lake:#1d5ba6;--rule:#d2dfee;--selection:#dbe8f6}body{margin:0;background:var(--canvas);color:var(--ink);font:1rem/1.6 Bricolage,system-ui,sans-serif}::selection{background:var(--selection);color:var(--ink)}[hidden]{display:none!important}.masthead{border-bottom:1px solid var(--rule);padding:1.25rem max(1.25rem,env(safe-area-inset-left));color:var(--lake);font-weight:750}.masthead div{width:min(100%,52rem);margin:auto}main{width:min(calc(100% - 3rem),46rem);margin:3rem auto 0;padding-bottom:max(3rem,env(safe-area-inset-bottom));overflow-wrap:anywhere}h1{font-size:2.5rem;line-height:1.12;letter-spacing:-.03em;font-weight:750;margin:0 0 1.25rem;text-wrap:balance}#status{max-width:65ch;color:var(--muted);margin:0;line-height:1.65}.context{margin:0 0 .4rem;color:var(--muted);font-size:1.125rem}.span{margin:0 0 2.5rem;font-weight:600;color:var(--lake)}section{border-top:1px solid var(--rule);padding-top:1.5rem;margin-top:2.5rem}h2{font-size:1.25rem;font-weight:650;line-height:1.3;margin:0 0 1.5rem;letter-spacing:-.02em}.hebrew{font-family:Hebrew,'Noto Serif Hebrew',serif;font-size:2rem;line-height:2;font-feature-settings:'mark','mkmk';margin:0 0 .75rem;white-space:pre-wrap;unicode-bidi:plaintext;text-align:start}.english{max-width:65ch;line-height:1.65;margin:0 0 2rem;white-space:pre-wrap;unicode-bidi:plaintext}.english:last-child{margin-bottom:0}.credits{border-top:1px solid var(--rule);margin-top:3rem;padding-top:1.5rem;color:var(--muted);font-size:.9375rem}.credits h2{font-size:1rem;margin-bottom:.75rem}.credits p{margin:.5rem 0;white-space:pre-wrap;unicode-bidi:plaintext}bdi{unicode-bidi:isolate}@media(prefers-color-scheme:dark){html{--canvas:#0b1626;--ink:#e9f0f8;--muted:#a8b8ca;--lake:#8dbbf5;--rule:#24384f;--selection:#10335e}}@media(max-width:600px){main{width:calc(100% - 2.5rem);margin-top:2rem}h1{font-size:2rem}.context{font-size:1rem}.hebrew{font-size:1.625rem}section{margin-top:2rem}}`;

export function honoreeLanding(request: Request): Response {
  if (request.method !== "GET") {
    const response = errorResponse(new HttpBoundaryError(405)); response.headers.set("allow", "GET"); return response;
  }
  const url = new URL(request.url);
  if (url.pathname !== "/honoree" || url.search || url.hash) return errorResponse(new HttpBoundaryError(404));
  const digest = (value: string) => createHash("sha256").update(value).digest("base64");
  const headers = privateHeaders();
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("content-security-policy", `default-src 'none'; script-src 'sha256-${digest(script)}'; style-src 'sha256-${digest(style)}'; font-src 'self'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'`);
  headers.set("x-frame-options", "DENY"); headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="referrer" content="no-referrer"><title>Your aliyah blessings · CRC Torah</title><script>${script}</script><style>${style}</style></head><body><header class="masthead"><div>CRC Torah · Beit Mitzvah blessings</div></header><main><h1 id="heading">Your aliyah blessings</h1><p id="status" role="status" aria-live="polite">Opening your invitation…</p><div id="reading" hidden></div><noscript><p>This invitation requires JavaScript. Reopen the original invitation in a browser with JavaScript enabled.</p></noscript></main></body></html>`, { headers });
}
