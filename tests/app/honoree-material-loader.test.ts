import { beforeEach, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("../../src/server/service-learning/data", () => ({ catalog: vi.fn() }));
vi.mock("../../src/server/service-learning/feed", () => ({ parseServiceFeed: vi.fn() }));
vi.mock("../../src/server/honoree/booklet-projector", async importOriginal => {
  const actual = await importOriginal<typeof import("../../src/server/honoree/booklet-projector")>();
  return { ...actual, projectBooklet: vi.fn() };
});
import { catalog } from "../../src/server/service-learning/data";
import { parseServiceFeed } from "../../src/server/service-learning/feed";
import { APPROVED_BOOKLET as approved, projectBooklet } from "../../src/server/honoree/booklet-projector";
import { loadHonoreeMaterial } from "../../src/server/honoree/material-loader";
import { unitPair } from "../../src/server/honoree/recipient-material";
import { digest } from "../../src/server/honoree/validation";

const output = { version: approved.version, before: [{ he: "Invented before", en: "Invented translation" }], after: [{ he: "Invented after", en: "Other invented translation" }], credits: ["Invented notice", "LicenseRef-Invented"] };
const row = () => ({ tenantId: "invented-tenant", id: "invented-catalog", identity: approved.identity,
  pins: { feedSha256: approved.feedSha256, provenanceSha256: approved.provenanceSha256, artifactRepo: approved.artifactRepo, artifactCommit: approved.artifactCommit, artifactRunId: approved.artifactRunId, sourceGitSha: approved.sourceGitSha }, feedBytes: new Uint8Array([1]), provenanceBytes: new Uint8Array([2]) });
const release = () => ({ id: "invented-release", createdAt: new Date(0), approvalBasis: "Invented approval", tenantId: "invented-tenant", catalogId: "invented-catalog", catalogIdentity: approved.identity, state: "active", slot: "morning", beforeId: unitPair("morning")[0], afterId: unitPair("morning")[1], materialVersion: approved.version, notices: output.credits, projectionDigest: digest(output) }) as Parameters<typeof loadHonoreeMaterial>[0];
const tx = {} as Parameters<typeof loadHonoreeMaterial>[1];
beforeEach(() => {
  vi.resetAllMocks(); vi.mocked(catalog).mockResolvedValue(row() as Awaited<ReturnType<typeof catalog>>);
  vi.mocked(parseServiceFeed).mockReturnValue({ identity: approved.identity } as ReturnType<typeof parseServiceFeed>);
  vi.mocked(projectBooklet).mockReturnValue(output);
});
test("uses exactly the held transaction/release catalog and checks liveness around read/parse/projection", async () => {
  const events: string[] = [], source = row(), feed = { identity: approved.identity } as ReturnType<typeof parseServiceFeed>;
  vi.mocked(catalog).mockImplementation(async (received, tenant, id) => { expect(received).toBe(tx); expect([tenant, id]).toEqual([source.tenantId, source.id]); events.push("read"); return source as Awaited<ReturnType<typeof catalog>>; });
  vi.mocked(parseServiceFeed).mockImplementation((bytes, provenance, pins) => { expect([bytes, provenance, pins]).toEqual([source.feedBytes, source.provenanceBytes, source.pins]); events.push("parse"); return feed; });
  vi.mocked(projectBooklet).mockImplementation((received, slot) => { expect(received).toBe(feed); expect(slot).toBe("morning"); events.push("project"); return output; });
  expect(await loadHonoreeMaterial(release(), tx, () => { events.push("live"); })).toEqual(output);
  expect(events).toEqual(["live", "read", "live", "parse", "live", "project", "live"]);
});
test("denies missing row, wrong tenant/catalog/identity and every wrong acquisition pin before parse", async () => {
  const rows = [null, ...["tenantId", "id", "identity"].map(key => ({ ...row(), [key]: "other" })), ...Object.keys(row().pins).map(key => ({ ...row(), pins: { ...row().pins, [key]: "other" } }))];
  for (const source of rows) { vi.mocked(catalog).mockResolvedValue(source as Awaited<ReturnType<typeof catalog>>); await expect(loadHonoreeMaterial(release(), tx, () => {})).rejects.toMatchObject({ status: 404 }); }
  expect(parseServiceFeed).not.toHaveBeenCalled(); expect(projectBooklet).not.toHaveBeenCalled();
});
test("denies withdrawn/unknown release before catalog and preserves digest/version/unit/ordered-credit fences", async () => {
  for (const edit of [{ state: "withdrawn" }, { slot: "unknown" }]) { await expect(loadHonoreeMaterial({ ...release(), ...edit } as ReturnType<typeof release>, tx, () => {})).rejects.toMatchObject({ status: 404 }); }
  expect(catalog).not.toHaveBeenCalled();
  for (const edit of [{ projectionDigest: "0".repeat(64) }, { materialVersion: "other" }, { beforeId: "other" }, { afterId: "other" }, { notices: [...output.credits].reverse() }, { catalogIdentity: "other" }]) {
    await expect(loadHonoreeMaterial({ ...release(), ...edit }, tx, () => {})).rejects.toMatchObject({ status: 404 });
  }
});
test("parse failure/mismatched identity and liveness denial cannot return material", async () => {
  vi.mocked(parseServiceFeed).mockReturnValue({ identity: "other" } as ReturnType<typeof parseServiceFeed>);
  await expect(loadHonoreeMaterial(release(), tx, () => {})).rejects.toMatchObject({ status: 404 }); expect(projectBooklet).not.toHaveBeenCalled();
  vi.mocked(parseServiceFeed).mockImplementation(() => { throw new Error("private source detail"); });
  await expect(loadHonoreeMaterial(release(), tx, () => {})).rejects.toMatchObject({ status: 404, message: "Not found" });
  for (const stop of [1, 2, 3, 4]) {
    vi.mocked(parseServiceFeed).mockReturnValue({ identity: approved.identity } as ReturnType<typeof parseServiceFeed>); let count = 0;
    await expect(loadHonoreeMaterial(release(), tx, () => { if (++count === stop) throw new Error("stopped"); })).rejects.toBeDefined();
  }
});
test("liveness lost during catalog wait denies before parsing", async () => {
  let finish!: (value: Awaited<ReturnType<typeof catalog>>) => void, allowed = true;
  vi.mocked(catalog).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = loadHonoreeMaterial(release(), tx, () => { if (!allowed) throw new Error("stopped"); });
  const rejected = expect(pending).rejects.toThrow("stopped");
  allowed = false; finish(row() as Awaited<ReturnType<typeof catalog>>);
  await rejected; expect(parseServiceFeed).not.toHaveBeenCalled(); expect(projectBooklet).not.toHaveBeenCalled();
});
