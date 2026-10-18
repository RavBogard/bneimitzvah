import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { honoreeLanding } from "../../src/server/http/honoree-landing";

// Invented transport data only; no blessing or licensed source text.
const token = `hl1.k1.${"A".repeat(22)}.${"A".repeat(43)}.${"A".repeat(43)}`;
const projection = () => ({ ok: true, schemaVersion: 1, student: { firstName: "Invented <img src=x>", ceremonyDate: "2027-01-02" },
  aliyah: { startVerse: "Genesis 1:1", endVerse: "Genesis 1:3" }, material: { version: "synthetic-v1", before: [{ he: "טקסט ניסיוני", en: "Invented before <script>hostile()</script>" }], after: [{ he: "דוגמה בלבד", en: "Invented after" }], credits: ["Synthetic example only <a href='https://example.test'>credit</a>"] }, expiresAt: "2027-01-09T06:00:00.000Z" });
const reply = (value: unknown = projection(), life: string | null = "90000") => Response.json(value, { headers: life === null ? {} : { "X-Honoree-Remaining-Ms": life } });

class Element {
  hidden = false;
  className = "";
  lang = "";
  dir = "";
  children: Element[] = [];
  private ownText = "";
  constructor(readonly tag: string) {}
  set textContent(text: string) { this.ownText = text; this.children = []; }
  get textContent(): string { return this.ownText + this.children.map(child => child.textContent).join(""); }
  append(...children: Element[]) { this.children.push(...children); }
  replaceChildren(...children: Element[]) { this.ownText = ""; this.children = children; }
}
async function harness(options: { hash?: string; query?: string; historyFails?: boolean; fetch?: () => Promise<Response> } = {}) {
  const response = honoreeLanding(new Request("https://example.test/honoree")), html = await response.text();
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1], style = html.match(/<style>([\s\S]*?)<\/style>/)![1];
  const events = new Map<string, (event?: { persisted?: boolean }) => unknown>(), timers = new Map<number, { action: () => void; ms: number }>();
  const reading = new Element("div"), heading = new Element("h1"), status = new Element("p"); reading.hidden = true;
  const elements: Record<string, Element> = { reading, heading, status };
  const location = { hash: options.hash ?? `#token=${token}`, search: options.query ?? "", pathname: "/honoree" };
  const history = { replaceState: vi.fn(() => { if (options.historyFails) throw Error("Invented history failure"); location.hash = ""; location.search = ""; }) };
  const document = { visibilityState: "visible", addEventListener: (name: string, action: () => unknown) => events.set(name, action),
    getElementById: (id: string) => elements[id], createElement: (tag: string) => new Element(tag), createDocumentFragment: () => new Element("fragment"), createTextNode: (text: string) => { const el = new Element("text"); el.textContent = text; return el; } };
  let now = 100, sequence = 0;
  const fetch = vi.fn(options.fetch ?? (async () => reply()));
  runInNewContext(script, { location, history, document, window: { addEventListener: (name: string, action: () => unknown) => events.set(name, action) }, fetch,
    setTimeout: (action: () => void, ms: number) => { const id = ++sequence; timers.set(id, { action, ms }); return id; }, clearTimeout: (id: number) => timers.delete(id),
    performance: { now: () => now }, AbortController, TextDecoder, TextEncoder, Intl, Date });
  return { response, html, script, style, history, document, events, timers, reading, heading, status, location, fetch,
    setNow(value: number) { now = value; }, open: () => events.get("DOMContentLoaded")!() as Promise<void>,
    expire: () => { const item = [...timers.entries()].at(-1)!; timers.delete(item[0]); item[1].action(); } };
}

test("static boundary and CSP isolate the reading and strip canonical fragment before loading", async () => {
  const f = await harness();
  expect(f.history.replaceState).toHaveBeenCalledWith(null, "", "/honoree"); expect(f.location.hash).toBe(""); expect(f.fetch).not.toHaveBeenCalled();
  expect(f.html).not.toContain(token);
  const csp = f.response.headers.get("content-security-policy")!;
  for (const value of [f.script, f.style]) expect(csp).toContain(`'sha256-${createHash("sha256").update(value).digest("base64")}'`);
  expect(csp).toContain("font-src 'self'"); expect(csp).toContain("frame-ancestors 'none'"); expect(csp).toContain("form-action 'none'");
  expect(csp).not.toMatch(/report|unsafe-inline/); expect(f.response.headers.get("cache-control")).toBe("private, no-store");
  expect(f.response.headers.get("referrer-policy")).toBe("no-referrer"); expect(f.response.headers.has("set-cookie")).toBe(false);
  expect(f.html).not.toMatch(/localStorage|sessionStorage|document\.cookie|innerHTML|__NEXT|OAuth|serviceWorker|Date\.now/);
  for (const method of ["POST", "HEAD", "OPTIONS"]) expect(honoreeLanding(new Request("https://example.test/honoree", { method })).status).toBe(405);
  expect(honoreeLanding(new Request("https://example.test/honoree?token=synthetic")).status).toBe(404);
});

test("canonical tokens only; query/history failure and pre-load departure never send a credential", async () => {
  for (const hash of ["", `#token=${token}&next=/`, `#token=${token.replace("hl1", "hl2")}`, `#token=${token.slice(0, -1)}B`, `#token=${token.replace("A".repeat(22), "A".repeat(21) + "B")}`, "#token=%68l1.k1"]) {
    const f = await harness({ hash }); await f.open(); expect(f.fetch).not.toHaveBeenCalled(); expect(f.reading.hidden).toBe(true);
  }
  for (const options of [{ query: "?tracking=1" }, { historyFails: true }]) {
    const f = await harness(options); await f.open(); expect(f.fetch).not.toHaveBeenCalled();
  }
  const f = await harness(); f.events.get("pagehide")!(); await f.open(); expect(f.fetch).not.toHaveBeenCalled();
});

test("body-only anonymous fetch renders hostile strings as text, ordered Hebrew/English and stable civil date", async () => {
  const f = await harness(); await f.open();
  const [url, options] = f.fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("/api/honoree/read"); expect(options).toMatchObject({ method: "POST", credentials: "omit", redirect: "error", cache: "no-store", referrerPolicy: "no-referrer" });
  expect(JSON.parse(String(options.body))).toEqual({ token }); expect(f.reading.hidden).toBe(false);
  expect(f.reading.textContent).toContain("Invented <img src=x> · January 2, 2027");
  expect(f.reading.textContent).toContain("Invented before <script>hostile()</script>");
  const children = f.reading.children[0].children;
  expect(children.map(n => n.tag)).toEqual(["p", "p", "section", "section", "footer"]);
  expect(children[2].children.map(n => [n.tag, n.lang, n.dir])).toEqual([["h2", "", ""], ["p", "he", "rtl"], ["p", "en", "auto"]]);
  expect(children[2].children[0].textContent).toBe("Before the reading"); expect(children[3].children[0].textContent).toBe("After the reading");
  expect(children[4].textContent).toContain("Synthetic example only <a"); expect(f.status.hidden).toBe(true);
  const display = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(projection().expiresAt));
  expect(children[4].children.at(-1)!.textContent).toBe("Available until " + display);
});

test("full fetch/read elapsed reduces authoritative life; long expiry uses bounded monotonic chunks", async () => {
  let resolve!: (response: Response) => void;
  const f = await harness({ fetch: () => new Promise(done => { resolve = done; }) }); const pending = f.open();
  f.setNow(2100); resolve(reply(projection(), "5000")); await pending;
  expect(f.reading.hidden).toBe(false); expect([...f.timers.values()][0].ms).toBe(3000);
  f.setNow(5100); f.expire(); expect(f.reading.hidden).toBe(true); expect(f.reading.textContent).toBe("");
  const long = await harness({ fetch: async () => reply(projection(), "7776000000") }); await long.open();
  expect([...long.timers.values()][0].ms).toBe(60000); long.setNow(60100); long.expire(); expect(long.reading.hidden).toBe(false);
  expect([...long.timers.values()][0].ms).toBe(60000);
  const stale = await harness({ fetch: async () => { stale.setNow(200); return reply(projection(), "100"); } }); await stale.open(); expect(stale.reading.hidden).toBe(true);
});

test("missing/invalid lifetime, closed DTO drift, invalid dates and excessive/invalid bytes fail generically", async () => {
  for (const life of [null, "0", "01", "+100", "1.5", "7776000001", "99999999999", "NaN"]) {
    const f = await harness({ fetch: async () => reply(projection(), life) }); await f.open(); expect(f.reading.hidden).toBe(true); expect(f.heading.textContent).toBe("This invitation is unavailable");
  }
  const extra = { ...projection(), participants: ["Invented private name"] }, badDate = projection(); badDate.student.ceremonyDate = "2027-02-30";
  const blockExtra = projection(); Object.assign(blockExtra.material.before[0], { transliteration: "forbidden extra" });
  for (const value of [extra, badDate, blockExtra]) { const f = await harness({ fetch: async () => reply(value) }); await f.open(); expect(f.reading.hidden).toBe(true); }
  for (const response of [new Response("x".repeat(98305), { headers: { "content-type": "application/json", "X-Honoree-Remaining-Ms": "1000" } }),
    new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json", "X-Honoree-Remaining-Ms": "1000" } }), new Response("private provider diagnostic", { status: 404 })]) {
    const f = await harness({ fetch: async () => response }); await f.open(); expect(f.reading.hidden).toBe(true); expect(f.status.textContent).not.toContain("provider");
  }
});

test("response body reading consumes lifetime and concealment cancels a stalled body", async () => {
  let finish!: () => void;
  const response = new Response(new ReadableStream({ start(controller) { finish = () => { controller.enqueue(new TextEncoder().encode(JSON.stringify(projection()))); controller.close(); }; } }),
    { headers: { "content-type": "application/json", "X-Honoree-Remaining-Ms": "5000" } });
  const f = await harness({ fetch: async () => response }), pending = f.open();
  // Yield to the response headers while deliberately withholding all body bytes.
  await Promise.resolve(); await Promise.resolve();
  f.setNow(2100); finish(); await pending;
  expect(f.reading.hidden).toBe(false); expect([...f.timers.values()][0].ms).toBe(3000);
  const cancel = vi.fn();
  let bodyRead!: () => void; const bodyReady = new Promise<void>(done => { bodyRead = done; });
  const stalled = new Response(new ReadableStream({ pull() { bodyRead(); }, cancel }, { highWaterMark: 0 }), { headers: { "content-type": "application/json", "X-Honoree-Remaining-Ms": "5000" } });
  const late = await harness({ fetch: async () => stalled }), reading = late.open();
  await bodyReady;
  late.document.visibilityState = "hidden"; late.events.get("visibilitychange")!(); await reading;
  expect(cancel).toHaveBeenCalled(); expect(late.reading.hidden).toBe(true); expect(late.reading.textContent).toBe("");
});

test("an app or tab switch says the blessings closed for privacy, while refusal and expiry keep the general wording", async () => {
  for (const event of ["visibilitychange", "pagehide", "beforeunload", "pageshow", "freeze"]) {
    const f = await harness(); await f.open(); if (event === "visibilitychange") f.document.visibilityState = "hidden";
    f.events.get(event)!({ persisted: true });
    expect(f.reading.hidden).toBe(true); expect(f.heading.textContent).toBe("Your blessings were closed for privacy");
    expect(f.status.textContent).toContain("doesn’t cancel your invitation"); expect(f.status.textContent).toContain("open the original invitation link again");
  }
  let resolve!: (response: Response) => void;
  const pending = await harness({ fetch: () => new Promise(done => { resolve = done; }) }), opened = pending.open();
  pending.document.visibilityState = "hidden"; pending.events.get("visibilitychange")!(); pending.document.visibilityState = "visible"; resolve(reply()); await opened;
  expect(pending.heading.textContent).toBe("Your blessings were closed for privacy"); expect(pending.reading.hidden).toBe(true);
  const expired = await harness(); await expired.open(); expired.setNow(90100); expired.expire();
  expect(expired.heading.textContent).toBe("This invitation is unavailable"); expect(expired.status.textContent).toContain("Reopen the original invitation");
});

test("concealment, departure, bfcache, freeze and timeout clear synchronously and late results never restore", async () => {
  for (const event of ["visibilitychange", "pagehide", "beforeunload", "pageshow", "freeze", "timeout"]) {
    const f = await harness(); await f.open(); expect(f.reading.hidden).toBe(false);
    if (event === "visibilitychange") f.document.visibilityState = "hidden";
    if (event === "timeout") { f.setNow(90100); f.expire(); } else f.events.get(event)!({ persisted: true });
    expect(f.reading.hidden).toBe(true); expect(f.reading.textContent).toBe("");
    expect((f.fetch.mock.calls[0] as unknown as [string, RequestInit])[1].signal!.aborted).toBe(true);
  }
  for (const event of ["visibilitychange", "pagehide", "pageshow", "timeout"]) {
    let resolve!: (response: Response) => void;
    const f = await harness({ fetch: () => new Promise(done => { resolve = done; }) }); const pending = f.open();
    if (event === "visibilitychange") f.document.visibilityState = "hidden";
    if (event === "timeout") f.expire(); else f.events.get(event)!({ persisted: true });
    f.document.visibilityState = "visible"; resolve(reply()); await pending;
    expect(f.reading.hidden).toBe(true); expect(f.reading.textContent).toBe(""); expect(f.fetch).toHaveBeenCalledTimes(1);
  }
});
