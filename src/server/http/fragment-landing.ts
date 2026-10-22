import "server-only";
import { createHash } from "node:crypto";
import { errorResponse, HttpBoundaryError, privateHeaders } from "./responses";

// Deliberately outside React/Next hydration. No fragment enters a framework
// router, render prop, DOM attribute, storage object, asset URL or report.
export function fragmentLanding(request: Request, kind: "email" | "invitation"): Response {
  const url = new URL(request.url);
  if (request.method !== "GET") {
    const response = errorResponse(new HttpBoundaryError(405)); response.headers.set("allow", "GET"); return response;
  }
  if (url.search || url.hash || url.pathname !== (kind === "email" ? "/auth/email" : "/invitations/open")) return errorResponse(new HttpBoundaryError());
  const invitation = kind === "invitation";
  const title = invitation ? "Review your invitation" : "Continue signing in";
  const endpoint = invitation ? "/api/invitations/open" : "/api/auth/email/confirm";
  const pattern = invitation ? "^#token=[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$" : "^#token=[A-Za-z]{32}$";
  const script = `(() => {
"use strict";
let token = "";
try {
  const fragment = location.hash;
  history.replaceState(null, "", location.pathname);
  if (!location.search && fragment.length < 100 && new RegExp(${JSON.stringify(pattern)}).test(fragment)) token = fragment.slice(7);
} catch { token = ""; }
let active = true, busy = false;
window.addEventListener("pagehide", () => { active = false; token = ""; });
document.addEventListener("DOMContentLoaded", () => {
  const button = document.getElementById("continue"), message = document.getElementById("message");
  const invalid = () => { button.disabled = true; message.textContent = "This link is missing or has expired. Reopen the latest email, or request a new link."; };
  if (!token) invalid(); else {
    button.disabled = false;
    message.textContent = ${JSON.stringify(invitation ? "Choose Review invitation to check the access offered by this link." : "Choose Continue signing in to use this link on this device.")};
  }
  const expiry = setTimeout(() => { token = ""; invalid(); }, 300000);
  window.addEventListener("pageshow", event => { if (event.persisted) { token = ""; invalid(); } });
  button.addEventListener("click", async () => {
    if (!active || busy || !token) return;
    busy = true; button.disabled = true; button.textContent = "Confirming…";
    message.textContent = "One moment while we confirm this link.";
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(${JSON.stringify(endpoint)}, { method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", signal: controller.signal,
        headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ token }) });
      token = "";
      if (!response.ok || !response.headers.get("content-type")?.startsWith("application/json")) throw 0;
      const reader = response.body?.getReader(); if (!reader) throw 0;
      let text = "", bytes = 0; const decoder = new TextDecoder("utf-8", { fatal: true });
      try { while (true) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > 1024) throw 0; text += decoder.decode(chunk.value, { stream: true }); } text += decoder.decode(); }
      finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
      const result = JSON.parse(text);
      if (!active || !result || result.ok !== true || Object.keys(result).sort().join() !== "next,ok" || !["/", "/invitations/accept"].includes(result.next)) throw 0;
      location.replace(result.next);
    } catch {
      if (active) { message.textContent = "This link could not be confirmed. Check your access, or reopen the latest email to try again."; button.textContent = "Link not confirmed"; }
    } finally { token = ""; clearTimeout(timeout); clearTimeout(expiry); }
  });
});
})();`;
  const style = `*{box-sizing:border-box}html{color-scheme:light}body{margin:0;background:#fff;color:#222c35;font:1rem/1.6 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}::selection{background:#0b6a62;color:#fff}a{color:#8a0a14;text-underline-offset:.2em}a:hover{color:#680911}a:focus-visible,button:focus-visible{outline:3px solid #0b6a62;outline-offset:4px}header,main,footer{width:min(100% - 3rem,72rem);margin-inline:auto}header{padding-block:1.5rem;border-bottom:1px solid #d5dcda;font-weight:600}main{padding-block:clamp(3rem,8vw,7rem);max-width:42rem;min-height:65vh}h1{font-size:clamp(1.5rem,5vw,3rem);font-weight:600;letter-spacing:-.03em;line-height:1.14;margin:0 0 1.5rem;text-wrap:balance}p{max-width:65ch;margin:0 0 1.5rem}button{min-height:48px;max-width:100%;border:1px solid #8a0a14;border-radius:6px;background:#8a0a14;color:#fff;font:600 1rem/1.4 system-ui,sans-serif;padding:.6875rem 1.125rem;cursor:pointer}button:hover{background:#680911}button:disabled{background:#f6f7f6;color:#53616a;border-color:#d5dcda;cursor:default}#message{margin-block:1.5rem;color:#53616a;min-height:3.2em}footer{border-top:1px solid #d5dcda;padding-block:1.5rem;color:#53616a}@media(max-width:40rem){header,main,footer{width:calc(100% - 2rem)}button{width:100%}}`;
  const digest = (value: string) => createHash("sha256").update(value).digest("base64");
  const headers = privateHeaders();
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("content-security-policy", `default-src 'none'; script-src 'sha256-${digest(script)}'; style-src 'sha256-${digest(style)}'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`);
  headers.set("x-frame-options", "DENY"); headers.set("x-robots-tag", "noindex, nofollow");
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>${title} · CRC Torah</title><script>${script}</script><style>${style}</style></head><body><header>CRC Torah</header><main><h1>${title}</h1><p>${invitation ? "Continue to check the invitation and the access it offers before you accept." : "Confirm that you want to sign in on this device. No password needed."}</p><button type="button" id="continue" disabled>${invitation ? "Review invitation" : "Continue signing in"}</button><p id="message" role="status" aria-live="polite">Open the latest email link to continue.</p><noscript><p>Open this link in a browser with JavaScript enabled to continue securely.</p></noscript><p><a href="/account">Check my access</a> · <a href="/sign-in">Request a new sign-in link</a></p></main><footer>Learning at Central Reform Congregation</footer></body></html>`, { headers });
}
