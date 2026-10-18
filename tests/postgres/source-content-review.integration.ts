// Independent real loopback transactions with invented public source data only.
import { randomUUID } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq } from "drizzle-orm";
import * as s from "../../src/server/db/index";
import { AccessDenied } from "../../src/server/access/errors";
import { createPracticeService } from "../../src/server/practice/service";
import { createSourceContentService } from "../../src/server/study/source-content-service";
import { createSourceAssignmentsService } from "../../src/server/study/source-assignments-service";
import { parseRelatedMetadata, parseEditionMetadata } from "../../src/server/study/sources/metadata";
import { projectRelatedCatalog } from "../../src/server/study/sources/discovery";
import { projectEditionCatalog } from "../../src/server/study/sources/editions";
import { deferred, postgresAccessFixture, waitForEntry } from "./access-fixture";

const fixtures: Awaited<ReturnType<typeof postgresAccessFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.close(); });
function safe<T>(pending: Promise<T>) { return pending.then(value => value, error => ({ denied: error instanceof AccessDenied ? error.status : 503 })); }
async function fixture() {
  const f = await postgresAccessFixture(); fixtures.push(f);
  const [member] = await f.ownerDb.select().from(s.membership).where(eq(s.membership.userId, f.admin.id));
  const [assignment] = await f.ownerDb.insert(s.assignment).values({ tenantId: "crc", studentId: f.student.id, kind: "torah", basis: "custom", ref: "Genesis 1:1", status: "confirmed", setByMembershipId: member.id }).returning();
  await f.ownerDb.insert(s.assignmentVerse).values({ tenantId: "crc", studentId: f.student.id, assignmentId: assignment.id, ordinal: 1, verseRef: "Genesis 1:1" });
  const work = "Invented Native Work", editionTitle = "Invented native edition", sourceRef = `${work} 1:1:1`;
  const catalog = parseRelatedMetadata([{ _id: "native_content", sourceRef, index_title: work, category: "Commentary", anchorRef: "Genesis 1:1" }], "Genesis 1:1");
  const versions = parseEditionMetadata([{ title: work, versionTitle: editionTitle, language: "en", actualLanguage: "he", license: "CC0", versionSource: "https://example.test/native" }], work);
  const selection = { mode: "tutor" as const, studentId: f.student.id, kind: "torah" as const, assignmentId: assignment.id, assignmentRevision: 1 };
  const request = () => { const value = f.request("tutor"); value.headers.set("origin", "http://localhost:3000"); return { ...value, method: "POST" }; };
  const sets = createSourceAssignmentsService({ access: f.b, practice: createPracticeService({ access: f.b }), related: async () => catalog });
  const sourceHash = projectRelatedCatalog(catalog, catalog.verse).catalogHash, editionHash = projectEditionCatalog(versions, work).editionCatalogHash;
  const write = (sourceIds = ["native_content"], expectedVersion = 0) => sets.replace(request(), selection, { verseRef: catalog.verse, sourceIds, expectedVersion, mutationId: randomUUID(), ...(sourceIds.length ? { catalogHash: sourceHash } : {}) });
  const textIntent = { verseRef: catalog.verse, sourceId: "native_content", sourceScope: "related" as const, sourceCatalogHash: sourceHash, editionCatalogHash: editionHash, editionTitle, language: "he" as const };
  return { ...f, assignment, catalog, versions, selection, requestFor: request, write, textIntent };
}

test("native content public wait holds no reading/authority transaction; independent clear/re-add invalidates the captured head", async () => {
  const f = await fixture(); expect(await f.write()).toMatchObject({ ok: true, committedVersion: 1 });
  const entered = deferred(), release = deferred(), related = vi.fn(async () => f.catalog);
  const content = createSourceContentService({ access: f.a, practice: createPracticeService({ access: f.a }), related,
    editions: async () => { entered.resolve(); await release.promise; throw new Error("Synthetic withheld public failure"); }, content: async () => ({}) });
  const { sourceCatalogHash: _hash, ...intent } = f.textIntent;
  const pending = safe(content.text(f.requestFor(), f.selection, { ...intent, sourceScope: "assigned", expectedSetVersion: 1 }));
  try {
    await waitForEntry(entered.promise, pending);
    // Both actual B transactions complete while public A remains deliberately pending.
    expect(await f.write([], 1)).toMatchObject({ ok: true, committedVersion: 2 });
    expect(await f.write(["native_content"], 2)).toMatchObject({ ok: true, committedVersion: 3 });
  } finally { release.resolve(); }
  expect(await pending).toEqual({ ok: false, error: "source-set-changed" }); expect(related).not.toHaveBeenCalled();
  expect(await f.ownerDb.select().from(s.verseSourceAssignment)).toHaveLength(3);
  expect(await f.ownerDb.select().from(s.auditEvent).where(eq(s.auditEvent.action, "source-assignment.set"))).toHaveLength(3);
});

test("native aggregate public timeout keeps final ordinary authority live and cannot hide committed tutor revocation", async () => {
  const f = await fixture(), entered = deferred(), release = deferred(), caller = new AbortController(); let time = 0;
  vi.spyOn(performance, "now").mockImplementation(() => time);
  const content = createSourceContentService({ access: f.a, practice: createPracticeService({ access: f.a }), related: async () => f.catalog,
    editions: async () => { entered.resolve(); await release.promise; time = 20001; return f.versions; }, content: async () => ({}) });
  const request = f.requestFor(), pending = safe(content.text({ ...request, signal: caller.signal }, f.selection, f.textIntent));
  try { await waitForEntry(entered.promise, pending); await f.ownerDb.update(s.tutorStudent).set({ revokedAt: new Date() }).where(eq(s.tutorStudent.id, f.link.id)); }
  finally { release.resolve(); }
  expect(await pending).toEqual({ denied: 404 }); expect(caller.signal.aborted).toBe(false);
  expect(await f.ownerDb.select().from(s.verseSourceAssignment)).toEqual([]);
});
