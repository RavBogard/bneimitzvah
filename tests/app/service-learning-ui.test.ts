import { afterEach, expect, it, vi } from "vitest";
import { parseCatalog, parsePreparation, parseServiceMetadata, parseServiceUnit, serviceApi, type ServicePlan } from "../../src/components/portal/workspace/service-learning/api";
import { PortalRequestError } from "../../src/components/portal/api";

const student = "10000000-0000-4000-8000-000000000001", catalogId = "10000000-0000-4000-8000-000000000002", planId = "10000000-0000-4000-8000-000000000003";
const first = "synthetic.first@bm-shacharit", second = "synthetic.second@bm-shacharit", identity = "a".repeat(64);
const section = { idx: 0, en: "Synthetic morning" };
const units = [{ id: first, name: "Synthetic first", section }, { id: second, name: "Synthetic second", section }];
const plan: ServicePlan = { id: planId, revision: 4, needsReview: true, catalogId, catalogIdentity: identity, catalogState: "active" };
const catalog = { state: "available" as const, studentRevision: 2, ceremonyDate: "2027-01-02", serviceSlot: "morning" as const, expectedPlanRevision: 4, catalogId, catalogIdentity: identity, lifecycleRevision: 3, units, defaults: [] as string[] };
const prepared = () => ({ ok: true, binding: "v1.synthetic", selectedIds: [first, second], clearsPlan: false, expiresAt: Date.now() + 60_000,
  review: { studentRevision: 2, ceremonyDate: "2027-01-02", serviceSlot: "morning", expectedPlanRevision: 4, catalogId, catalogIdentity: identity, lifecycleRevision: 3 } });
const material = () => ({ unit: { id: first, family: "bm-shacharit", name: "Synthetic first", section: 0, blocks: [{ type: "stanza", he: "אָ֑ב", en: [{ t: "Synthetic meaning" }, { footnote: [{ t: "Synthetic author" }] }] }, { type: "english", role: "original", en: "Synthetic original prose" }] },
  section, license: { spdx: "LicenseRef-Synthetic", attribution: "Synthetic CRC credit" }, source: { catalogIdentity: identity, sourceGitSha: "abcdef1-LICENSED", sourceBuiltAt: "2026-10-16T00:00:00Z", artifactCommit: "b".repeat(40), artifactRunId: "123" }, blockGranularity: "line" });
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
afterEach(() => vi.unstubAllGlobals());

it("retains distinct no-plan, explicit clearing and withdrawal states without leaking prior unit summaries", () => {
  expect(parseServiceMetadata({ state: "no-plan" })).toEqual({ state: "no-plan" });
  for (const state of ["cleared", "withdrawn"] as const) {
    expect(parseServiceMetadata({ state, plan })).toEqual({ state, plan });
    expect(() => parseServiceMetadata({ state, plan, units })).toThrow(PortalRequestError);
  }
  expect(() => parseServiceMetadata({ state: "no-plan", plan })).toThrow(PortalRequestError);
});

it("keeps still-readable superseded material and preserves the needs-review flag", () => {
  const superseded = { ...plan, catalogState: "superseded" };
  expect(parseServiceMetadata({ state: "assigned", plan: superseded, units })).toMatchObject({ state: "assigned", plan: { catalogState: "superseded", needsReview: true } });
  expect(parseServiceUnit({ state: "assigned", plan: superseded, material: material() }, plan, first)).toMatchObject({ state: "assigned", plan: { catalogState: "superseded" } });
  expect(() => parseServiceMetadata({ state: "assigned", plan: { ...plan, catalogState: "retired" }, units })).toThrow();
});

it("accepts the siddur page and service start when present and when absent, and refuses malformed ones", () => {
  const assigned = { state: "assigned", plan, units };
  expect(parseServiceMetadata(assigned)).toEqual(assigned);
  expect(parseServiceMetadata({ ...assigned, units: units.map(unit => ({ ...unit, page: 10 })), serviceStart: 33 })).toEqual({ ...assigned, units: units.map(unit => ({ ...unit, page: 10 })), serviceStart: 33 });
  expect(parseServiceMetadata({ ...assigned, units: [{ ...units[0], page: 22 }, units[1]] })).toMatchObject({ units: [{ page: 22 }, { id: second }] });
  for (const bad of [0, -1, 1.5, "10", null]) {
    expect(() => parseServiceMetadata({ ...assigned, serviceStart: bad })).toThrow(PortalRequestError);
    expect(() => parseServiceMetadata({ ...assigned, units: [{ ...units[0], page: bad }] })).toThrow(PortalRequestError);
  }
  expect(() => parseServiceMetadata({ ...assigned, extra: 1 })).toThrow(PortalRequestError);
  expect(() => parseServiceMetadata({ state: "cleared", plan, serviceStart: 1 })).toThrow(PortalRequestError);
  expect(parseCatalog({ ...catalog, units: units.map(unit => ({ ...unit, page: 7 })) })).toMatchObject({ state: "available", units: [{ page: 7 }, { page: 7 }] });
});

it("requires explicit known-slot catalog families, unique IDs and a closed authoritative context", () => {
  expect(parseCatalog(catalog)).toEqual(catalog);
  expect(parseCatalog({ state: "unknown-slot" })).toEqual({ state: "unknown-slot" });
  for (const changed of [{ ...catalog, serviceSlot: "unknown" }, { ...catalog, units: [units[0], units[0]] }, { ...catalog, serviceSlot: "havdalah" }, { ...catalog, sourceText: "Unselected text" }]) expect(() => parseCatalog(changed)).toThrow();
  // Standard parts are offered only before any plan exists, only from this catalog, and come back in catalog order.
  const fresh = { ...catalog, expectedPlanRevision: 0 };
  expect((parseCatalog({ ...fresh, defaults: [units[1].id, units[0].id] }) as typeof fresh).defaults).toEqual([units[0].id, units[1].id]);
  for (const changed of [{ ...catalog, defaults: [units[0].id] }, { ...fresh, defaults: ["torah.blessing-before-the-torah-reading@bm-shacharit"] }, { ...fresh, defaults: [units[0].id, units[0].id] }, (({ defaults: _, ...rest }) => rest)(fresh)]) expect(() => parseCatalog(changed)).toThrow();
});

it("accepts only the server's exact canonical selection and bound review context/expiry", () => {
  expect(parsePreparation(prepared(), catalog, [second, first])).toMatchObject({ selectedIds: [first, second], clearsPlan: false });
  const empty = { ...prepared(), selectedIds: [], clearsPlan: true };
  expect(parsePreparation(empty, catalog, [])).toMatchObject({ clearsPlan: true });
  for (const changed of [{ ...prepared(), selectedIds: [second, first] }, { ...prepared(), selectedIds: [first] }, { ...prepared(), clearsPlan: true }, { ...prepared(), expiresAt: Date.now() - 1 }, { ...prepared(), review: { ...prepared().review, studentRevision: 3 } }]) expect(() => parsePreparation(changed, catalog, [first, second])).toThrow();
});

it("binds selected material to its exact plan, unit and source while preserving nested spans/original English", () => {
  const parsed = parseServiceUnit({ state: "assigned", plan, material: material() }, plan, first);
  expect(parsed).toMatchObject({ state: "assigned", material: { unit: { blocks: [{ en: [{ t: "Synthetic meaning" }, { footnote: [{ t: "Synthetic author" }] }] }, { role: "original", en: "Synthetic original prose" }] } } });
  expect(() => parseServiceUnit({ state: "assigned", plan: { ...plan, revision: 5 }, material: material() }, plan, first)).toThrow(PortalRequestError);
  expect(() => parseServiceUnit({ state: "assigned", plan, material: material() }, plan, second)).toThrow();
  expect(() => parseServiceUnit({ state: "assigned", plan, material: { ...material(), source: { ...material().source, catalogIdentity: "c".repeat(64) } } }, plan, first)).toThrow();
});

it("rejects unprojected text, transliteration, coordinate/companion data and malformed material atomically", () => {
  for (const changed of [
    { ...material(), front: [] },
    { ...material(), unit: { ...material().unit, companionOf: second } },
    { ...material(), unit: { ...material().unit, blocks: [{ type: "stanza", he: "אָ֑ב", tr: "Latin sentinel" }] } },
    { ...material(), unit: { ...material().unit, blocks: [{ type: "stanza", he: "אָ֑ב", folio: 3 }] } },
    { ...material(), unit: { ...material().unit, blocks: [{ type: "english", en: [{ html: "<script>" }] }] } },
  ]) expect(() => parseServiceUnit({ state: "assigned", plan, material: changed }, plan, first)).toThrow();
});

it("keeps linked-child handles in headers and sends revision-bound unit bodies without URL content or retries", async () => {
  const fetch = vi.fn().mockResolvedValue(response({ state: "assigned", plan, material: material() })); vi.stubGlobal("fetch", fetch);
  const selection = { handle: "h".repeat(43), context: { id: "10000000-0000-4000-8000-000000000004", studentId: student, studentRevision: 2, authorityRevision: 1, expiresAt: new Date(Date.now() + 60_000).toISOString() } };
  await serviceApi.unit("child-practice", student, plan, first, new AbortController().signal, selection);
  const [path, options] = fetch.mock.calls[0];
  expect(path).toBe(`/api/students/${student}/service-plan/unit`); expect(path).not.toContain(selection.handle);
  expect(options.headers.get("X-Practice-Context")).toBe(selection.handle);
  expect(JSON.parse(options.body)).toEqual({ mode: "child-practice", planId, planRevision: 4, catalogIdentity: identity, unitId: first });
  expect(options.cache).toBe("no-store"); expect(options.credentials).toBe("same-origin");
  fetch.mockResolvedValue(response({ state: "stale" }, 409));
  await expect(serviceApi.metadata("parent", student, new AbortController().signal)).rejects.toMatchObject({ status: 409 });
  expect(fetch).toHaveBeenCalledTimes(2); expect(fetch.mock.calls[1][1].headers.has("X-Practice-Context")).toBe(false);
});

it("bounds private material bodies before parsing and never accepts source-selected extra fields", async () => {
  const fetch = vi.fn().mockResolvedValue(response({ padding: "x".repeat(256 * 1024) })); vi.stubGlobal("fetch", fetch);
  await expect(serviceApi.metadata("student", student, new AbortController().signal)).rejects.toMatchObject({ status: 503 });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("draws a siddur link on a part only when it has a page and the siddur is the recognised reader, with the approved wording", async () => {
  const { createElement } = await import("react"), { renderToStaticMarkup } = await import("react-dom/server");
  const { SiddurPageLink } = await import("../../src/components/portal/siddur-link"), { DEFAULT_SIDDUR_URL } = await import("../../src/server/settings/validation");
  const render = (siddurUrl: string, page: number | undefined, block = false, text = "Open in the siddur, page 11") => renderToStaticMarkup(createElement(SiddurPageLink, { siddurUrl, page, block, children: text }));
  const link = render(DEFAULT_SIDDUR_URL, 11);
  expect(link).toContain('>Open in the siddur, page 11<span class="sr-only">, opens in a new tab</span></a>');
  expect(link).toContain(`href="${new URL(DEFAULT_SIDDUR_URL).origin}/?book=legacy-beit-mitzvah&amp;p=11"`);
  expect(link).toContain('target="_blank"');
  expect(link).toMatch(/rel="[^"]*noopener/);
  expect(render(DEFAULT_SIDDUR_URL, 33, true, "Your whole service in the siddur, from page 33")).toMatch(/^<p><a [^>]*>Your whole service in the siddur, from page 33<span class="sr-only">, opens in a new tab<\/span><\/a><\/p>$/);
  for (const page of [undefined, 0, -1, 1.5, 10_000]) expect(render(DEFAULT_SIDDUR_URL, page)).toBe("");
  for (const other of ["https://example.org/", "http://siddur.example.com/", "not a url", ""]) expect(render(other, 11)).toBe("");
});
