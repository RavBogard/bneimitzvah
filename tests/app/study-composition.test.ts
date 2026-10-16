import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createPublicStudyCoalescer } from "../../src/server/study/coalescing";
import { createSefariaStudyReader } from "../../src/server/study/sefaria";
import { createStudyCacheEntry, studyCacheBinding, studyChapterHash, type StudyCacheEntry, type StudyChapterCache } from "../../src/server/study/cache";
import { normalizeHebrew } from "../../src/server/study/normalize";
import { MAM, JPS2023 } from "../../src/server/study/versions";
import { TANAKH_VERSE_COUNTS } from "../../src/lib/readings/catalog";
import { syntheticChapter, syntheticRequest, syntheticResponse, deferred } from "../helpers/study";

test("shared public tasks retain independent cancellation and replay streamed byte accounting", async () => {
  const tasks = createPublicStudyCoalescer(), a = new AbortController(), b = new AbortController();
  const result = deferred<number>(), entered = deferred();
  let taskSignal!: AbortSignal, progress!: (bytes: number) => void, calls = 0;
  const task = async (signal: AbortSignal, bytes: (total: number) => void) => { calls++; taskSignal = signal; progress = bytes; entered.resolve(); return result.promise; };
  const first = tasks.run("public:chapter", task, a.signal, () => {});
  await entered.promise; progress(100);
  const replay: number[] = [];
  const second = tasks.run("public:chapter", task, b.signal, bytes => { replay.push(bytes); });
  a.abort(); await expect(first).rejects.toMatchObject({ code: "upstream" });
  expect(taskSignal.aborted).toBe(false); expect(calls).toBe(1);
  progress(200); result.resolve(7);
  expect(await second).toBe(7); expect(replay).toEqual([100, 200]);
  expect(await tasks.run("public:chapter", async () => 8, b.signal, () => {})).toBe(8);
});

test("shared tasks have a32-key cap with no queue, clean on last abort, and reject stalled work by deadline", async () => {
  const tasks = createPublicStudyCoalescer(), controllers = Array.from({ length: 32 }, () => new AbortController());
  const pending = controllers.map((controller, i) => tasks.run(`public:${i}`, async () => new Promise<never>(() => {}), controller.signal, () => {}));
  await expect(tasks.run("public:overflow", async () => 1, new AbortController().signal, () => {})).rejects.toMatchObject({ code: "upstream" });
  controllers.forEach(controller => controller.abort()); await Promise.allSettled(pending);
  expect(await tasks.run("public:after-cleanup", async () => 1, new AbortController().signal, () => {})).toBe(1);
  await expect(createPublicStudyCoalescer({ taskMs: 10 }).run("public:stall", async () => new Promise<never>(() => {}), new AbortController().signal, () => {}))
    .rejects.toMatchObject({ code: "upstream", message: "Study text unavailable" });
});

test("one subscriber's byte limit cannot cancel another and last cancellation cleans late response bodies", async () => {
  const tasks = createPublicStudyCoalescer(), finish = deferred<number>(), entered = deferred();
  let progress!: (total: number) => void, signal!: AbortSignal;
  const task = async (s: AbortSignal, p: (total: number) => void) => { signal = s; progress = p; entered.resolve(); return finish.promise; };
  const limited = tasks.run("public:budget", task, new AbortController().signal, bytes => { if (bytes > 1) throw 0; });
  const other = tasks.run("public:budget", task, new AbortController().signal, () => {});
  await entered.promise; progress(2);
  await expect(limited).rejects.toMatchObject({ code: "invalid-response" }); expect(signal.aborted).toBe(false);
  finish.resolve(4); expect(await other).toBe(4);

  const response = deferred<Response>(), fetchEntered = deferred(), controller = new AbortController(); let canceled = false;
  const load = createSefariaStudyReader({ fetch: async () => { fetchEntered.resolve(); return response.promise; }, verseCounts: TANAKH_VERSE_COUNTS, coalescer: tasks });
  const page = load({ ...syntheticRequest(), signal: controller.signal });
  await fetchEntered.promise; controller.abort(); await expect(page).rejects.toMatchObject({ code: "upstream" });
  response.resolve(new Response(new ReadableStream({ cancel() { canceled = true; } }), { headers: { "content-type": "application/json" } }));
  await vi.waitFor(() => expect(canceled).toBe(true));
});

test("coalesced reader fetches once, writes complete normalized chapters independently, and serves validated cache hits", async () => {
  const store = new Map<string, StudyCacheEntry>();
  const cache: StudyChapterCache = { get: async binding => store.get(`${binding.book} ${binding.chapter}`) ?? null,
    set: async (binding, entry) => { store.set(`${binding.book} ${binding.chapter}`, entry); } };
  const barrier = deferred(), ready = deferred(), fetch = vi.fn<typeof globalThis.fetch>(async () => { ready.resolve(); await barrier.promise; return syntheticResponse(); });
  const load = createSefariaStudyReader({ fetch, verseCounts: TANAKH_VERSE_COUNTS, cache, coalescer: createPublicStudyCoalescer() });
  const first = load(syntheticRequest()), second = load(syntheticRequest(["Genesis 1:2"]));
  await ready.promise; barrier.resolve();
  expect((await first).verses.length).toBe(3); expect((await second).verses.length).toBe(1);
  expect(fetch).toHaveBeenCalledTimes(1); expect(store.get("Genesis 1")?.payload.verses.length).toBe(31);
  expect((await load(syntheticRequest())).verses.length).toBe(3); expect(fetch).toHaveBeenCalledTimes(1);
  const payload = syntheticChapter(); payload.versions[1].text[1] = "";
  const partial = await createSefariaStudyReader({ fetch: async () => new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } }), verseCounts: TANAKH_VERSE_COUNTS })(syntheticRequest());
  expect(partial.translation.status).toBe("partial");
});

test("cache hits and coalesced results both count complete chapters against the page byte cap", async () => {
  const now = Date.now(), entries = new Map<string, StudyCacheEntry>();
  for (let chapter = 1; chapter <= 5; chapter++) {
    const binding = studyCacheBinding(`Genesis ${chapter}`), count = TANAKH_VERSE_COUNTS.Genesis[chapter - 1];
    const payload = { editions: [MAM, JPS2023], verses: Array.from({ length: count }, (_, i) => ({ ref: `Genesis ${chapter}:${i + 1}`,
      hebrew: normalizeHebrew("אב"), english: "x".repeat(Math.floor(440000 / count)) })) };
    entries.set(`Genesis ${chapter}`, createStudyCacheEntry(binding, { ...payload, fetchedAt: now, hash: studyChapterHash({ verses: payload.verses, editions: payload.editions }) }));
  }
  const fetch = vi.fn<typeof globalThis.fetch>(async url => syntheticResponse(decodeURIComponent(new URL(String(url)).pathname.split("/").pop()!), 450 * 1024));
  const cached = createSefariaStudyReader({ fetch, verseCounts: TANAKH_VERSE_COUNTS, cache: { get: async binding => entries.get(`${binding.book} ${binding.chapter}`) ?? null, set: async () => {} } });
  const request = syntheticRequest(Array.from({ length: 5 }, (_, i) => `Genesis ${i + 1}:1`));
  await expect(cached(request)).rejects.toMatchObject({ code: "invalid-response" }); expect(fetch).not.toHaveBeenCalled();
  const shared = createSefariaStudyReader({ fetch, verseCounts: TANAKH_VERSE_COUNTS, coalescer: createPublicStudyCoalescer() });
  await expect(shared(request)).rejects.toMatchObject({ code: "invalid-response" });
  expect(fetch.mock.calls.length).toBe(5);
});
