import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CRC_TENANT } from "../../src/lib/service-course/course";
import { assignedItems, baseUnitId, defaultItems, lessonForUnit, parsePath, tenantFile, type Path } from "../../src/lib/service-course/path";
import { completeLesson, emptyProgress, nextLesson, nextOnPath } from "../../src/lib/service-course/progress";
import { lessonById } from "../../src/lib/service-course/course";
import { COPY } from "../../src/lib/service-course/copy";
import { YourParts } from "../../src/components/learn/service/home";
import { loadPath, pathLessons, type PathView } from "../../src/components/learn/service/progress";

// Release 2.0 SC4: the pure half of a student's own path (A4 6.3) and the "Your parts" states (W2, W3). Synthetic ids only.
const PLAN = { id: "10000000-0000-4000-8000-000000000003", revision: 2, catalogId: "10000000-0000-4000-8000-000000000002", catalogIdentity: "a".repeat(64) };
const path = (value: Partial<Path> = {}): Path => ({ ok: true, state: "assigned", slot: "morning", review: false, items: [{ lesson: "vahavta", page: 11 }, { lesson: "torah-before", page: 22 }], serviceStart: 1, plan: PLAN, ...value });

describe("mapping a plan to lessons", () => {
  it("strips the service family and maps a unit through the congregation file, or to nothing", () => {
    expect(baseUnitId("shma.the-shma@bm-shacharit")).toBe("shma.the-shma");
    expect(baseUnitId("shma.the-shma@bm-maariv")).toBe("shma.the-shma");
    for (const bad of ["shma.the-shma", "shma.the-shma@shabbat-shacharit", "shma.the-shma@bm-shacharit@bm-maariv"]) expect(baseUnitId(bad) === null || lessonForUnit(CRC_TENANT, bad) === null, bad).toBe(true);
    expect(lessonForUnit(CRC_TENANT, "shma.the-shma@bm-shacharit")).toBe("shma");
    expect(lessonForUnit(CRC_TENANT, "torah.blessing-following-the-haftarah-reading@bm-shacharit")).toBe("haftarah-after");
    expect(lessonForUnit(CRC_TENANT, "sample.first@bm-shacharit")).toBeNull();
    expect(tenantFile("crc")).toBe(CRC_TENANT);
    expect(tenantFile("other")).toBeNull();
  });
  it("keeps the plan's order, drops a unit no lesson teaches, lists a lesson once, and keeps only whole printed pages", () => {
    expect(assignedItems(CRC_TENANT, [{ id: "sample.first@bm-shacharit", page: 1 }, { id: "shma.vahavta@bm-shacharit", page: 11 }, { id: "shma.the-shma@bm-shacharit", page: 10 },
      { id: "shma.vahavta@bm-maariv", page: 40 }, { id: "torah.blessing-before-the-torah-reading@bm-shacharit", page: 0 }]))
      .toEqual([{ lesson: "vahavta", page: 11 }, { lesson: "shma", page: 10 }, { lesson: "torah-before" }]);
  });
  it("gives the default six the learner's own pages: the morning's, the morning's for an unset slot, and the evening's (2.0 SC7) for an evening student", () => {
    const morning = defaultItems(CRC_TENANT, "morning");
    expect(morning.map(item => item.lesson)).toEqual(CRC_TENANT.defaultPath);
    expect(morning.map(item => item.page)).toEqual([10, 11, 22, 22, 23, 24]);
    expect(defaultItems(CRC_TENANT, "unknown")).toEqual(morning);
    expect(defaultItems(CRC_TENANT, "havdalah").map(item => item.page)).toEqual([39, 40, 52, 52, 53, 54]);
  });
});

describe("the path's answer in the browser", () => {
  it("is parsed strictly: a name, a caption, an unknown lesson or key, a bad page or a list on a cleared plan is no answer", () => {
    expect(parsePath(path())).toEqual(path());
    expect(parsePath({ ok: true, state: "no-plan", slot: "unknown", review: false, items: [{ lesson: "shma", page: 10 }] })).toMatchObject({ state: "no-plan", slot: "unknown" });
    const bad: unknown[] = [null, [], { ...path(), name: "x" }, { ...path(), items: [{ lesson: "vahavta", name: "Synthetic" }] }, { ...path(), items: [{ lesson: "vahavta", caption: "Synthetic" }] },
      { ...path(), items: [{ lesson: "no-such-lesson" }] }, { ...path(), items: [{ lesson: "vahavta", page: 0 }] }, { ...path(), items: [{ lesson: "vahavta", page: 1.5 }] },
      { ...path(), items: [{ lesson: "vahavta" }, { lesson: "vahavta" }] }, { ...path(), state: "stale" }, { ...path(), slot: "evening" }, { ...path(), review: "no" },
      { ...path(), ok: false }, { ...path(), serviceStart: -1 }, { ...path(), plan: { ...PLAN, extra: 1 } }, { ...path(), plan: { ...PLAN, id: "x" } },
      { ...path(), state: "cleared" }, { ...path(), units: [] }];
    for (const value of bad) expect(parsePath(value), JSON.stringify(value).slice(0, 80)).toBeNull();
  });
  it("asks once with no credentials beyond the cookie and no cache, and reads 401, 403 and 404 as no parts and anything else as an error", async () => {
    const seen: RequestInit[] = [];
    const reply = (status: number, body: unknown, type = "application/json") => (async (_: unknown, init?: RequestInit) => { seen.push(init!); return new Response(JSON.stringify(body), { status, headers: { "content-type": type } }); }) as unknown as typeof fetch;
    expect(await loadPath(reply(200, path()))).toEqual({ status: "ready", path: path() });
    expect(seen[0]).toMatchObject({ method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer" });
    for (const status of [401, 403, 404]) expect(await loadPath(reply(status, { error: "x" }))).toEqual({ status: "none" });
    for (const [status, body, type] of [[503, {}, "application/json"], [200, { ...path(), name: "x" }, "application/json"], [200, path(), "text/html"]] as const)
      expect(await loadPath(reply(status, body, type))).toEqual({ status: "error" });
    expect(await loadPath((async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toEqual({ status: "error" });
  });
});

describe("Next and the Done screen's next part", () => {
  it("is the first undone of the student's own parts, then the course; the fluency strand never", () => {
    const parts = ["torah-before", "vahavta"];
    expect(nextLesson(emptyProgress(), CRC_TENANT, parts)?.id).toBe("torah-before");
    const one = completeLesson(emptyProgress(), lessonById("torah-before")!, 1);
    expect(nextOnPath(one, parts)?.id).toBe("vahavta");
    const both = completeLesson(one, lessonById("vahavta")!, 2);
    expect(nextOnPath(both, parts)).toBeNull();
    expect(nextLesson(both, CRC_TENANT, parts)?.id).toBe("shma");
  });
  it("uses a path only when the home lists one", () => {
    expect(pathLessons({ status: "ready", path: path() })).toEqual(["vahavta", "torah-before"]);
    expect(pathLessons({ status: "ready", path: path({ state: "no-plan", plan: undefined, serviceStart: undefined }) })).toEqual(["vahavta", "torah-before"]);
    for (const view of [{ status: "idle" }, { status: "loading" }, { status: "none" }, { status: "error" }, { status: "ready", path: path({ state: "cleared", items: [] }) },
      { status: "ready", path: path({ items: [] }) }] as PathView[]) expect(pathLessons(view), JSON.stringify(view).slice(0, 60)).toBeNull();
  });
});

describe("Your parts, in each of its states", () => {
  const render = (view: PathView) => renderToStaticMarkup(createElement(YourParts, { view, progress: emptyProgress(), next: null }));
  it("shows nothing signed out, before the account is known, or for an account with no student of its own", () => {
    for (const status of ["idle", "none"] as const) expect(render({ status })).toBe("");
  });
  it("lists the student's parts in order with their own pages and the whole service's first page, in the approved words only", () => {
    const html = render({ status: "ready", path: path() });
    expect(html).toContain(`>${COPY.home.mineHeading}<`);
    expect(html).toContain(COPY.home.mineLine);
    expect(html.indexOf("data-lesson=\"vahavta\"")).toBeLessThan(html.indexOf("data-lesson=\"torah-before\""));
    expect(html).toContain("Open in the siddur, page 11");
    expect(html).toContain("Open in the siddur, page 22");
    expect(html).toContain("Your whole service in the siddur, from page 1");
    expect(html).toMatch(/href="[^"]*legacy-beit-mitzvah[^"]*"/);
    expect(html).not.toContain(COPY.state.pathReview);
  });
  it("has a line for loading, an error, no plan, a review, a cleared plan, a withdrawn catalog and an unset service time", () => {
    expect(render({ status: "loading" })).toContain(COPY.state.pathLoading);
    expect(render({ status: "error" })).toContain(COPY.state.pathError);
    const none = render({ status: "ready", path: path({ state: "no-plan", plan: undefined, serviceStart: undefined }) });
    expect(none).toContain(COPY.state.pathNoPlan);
    expect(none).not.toContain(COPY.home.mineLine);
    expect(render({ status: "ready", path: path({ review: true }) })).toContain(COPY.state.pathReview);
    expect(render({ status: "ready", path: path({ state: "cleared", items: [], serviceStart: undefined }) })).toContain(COPY.state.pathCleared);
    expect(render({ status: "ready", path: path({ state: "withdrawn", items: [], serviceStart: undefined }) })).toContain(COPY.state.pathWithdrawn);
    expect(render({ status: "ready", path: path({ slot: "unknown" }) })).toContain(COPY.state.slotUnknown);
    for (const state of ["cleared", "withdrawn"] as const) expect(render({ status: "ready", path: path({ state, items: [], serviceStart: undefined }) })).not.toContain("data-lesson");
  });
  it("adds no string the plans have not approved", () => {
    const approved = ["Your parts", "The prayers you lead, in service order.", "Your whole service in the siddur, from page {page}", "Next of your parts: {lesson}", "Checking your parts…",
      "Your parts could not be loaded. The whole service is below.", "Your tutor hasn’t chosen your parts yet. These are the parts most students lead.",
      "No service parts are assigned to you right now.", "Your parts may change. Your tutor will review them with you.", "Your parts are being updated. Ask your tutor which ones you lead.",
      "Page numbers are from the morning service until your service time is set."];
    expect([COPY.home.mineHeading, COPY.home.mineLine, COPY.home.serviceStart, COPY.done.nextMine, COPY.state.pathLoading, COPY.state.pathError, COPY.state.pathNoPlan,
      COPY.state.pathCleared, COPY.state.pathReview, COPY.state.pathWithdrawn, COPY.state.slotUnknown]).toEqual(approved);
  });
  it("tells the student their tutor can see finished parts (2.0 SC5, A7 tu.student.line) under assigned parts only, where a tutor sees them", () => {
    expect(COPY.tutor.studentLine).toBe("Your tutor can see which of your parts you’ve finished.");
    expect(render({ status: "ready", path: path() })).toContain(COPY.tutor.studentLine);
    // With no plan the tutor's view has no parts, so the line would not be true; nor with no list at all.
    expect(render({ status: "ready", path: path({ state: "no-plan", plan: undefined, serviceStart: undefined }) })).not.toContain(COPY.tutor.studentLine);
    for (const state of ["cleared", "withdrawn"] as const) expect(render({ status: "ready", path: path({ state, items: [], serviceStart: undefined }) })).not.toContain(COPY.tutor.studentLine);
    for (const status of ["idle", "none", "loading", "error"] as const) expect(render({ status })).not.toContain(COPY.tutor.studentLine);
  });
});
