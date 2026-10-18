import { randomBytes, randomUUID } from "node:crypto";
import { honorsFixture, emptyForm, person } from "./honors-fixture";
import * as s from "../../src/server/db/index";
import { createHonoreeService } from "../../src/server/honoree/service";
import { material, unitPair } from "../../src/server/honoree/recipient-material";
import { digest } from "../../src/server/honoree/validation";
export const syntheticMaterial = material({ version: "synthetic-reviewed-v1", before: [{ he: "Synthetic before Hebrew", en: "Synthetic before English" }], after: [{ he: "Synthetic after Hebrew", en: "Synthetic after English" }], credits: ["Synthetic fixture only; no licensed bodies"] });
export async function honoreeFixture(approved = true) {
  const f = await honorsFixture(), secret = randomBytes(48).toString("base64url");
  const form = { ...emptyForm(), aliyot: ["Genesis 1:1", "Genesis 1:3"].map(startVerse => ({ startVerse, participants: [{ ...person(), relationship: null, hebrewName: null, parent1HebrewName: null, parent2HebrewName: null }] })) };
  await f.service.replace(f.req(), f.selected, await f.intent(form));
  const release = approved ? await f.owner(async () => {
    const [catalog] = await f.db.insert(s.serviceCatalog).values({ tenantId: "crc", identity: digest("synthetic-catalog"), feedBytes: Buffer.from("synthetic-feed"), provenanceBytes: Buffer.from("synthetic-provenance"), pins: { feedSha256: "0".repeat(64), provenanceSha256: "0".repeat(64), artifactRepo: "synthetic/repo", artifactCommit: "0".repeat(40), artifactRunId: "1", sourceGitSha: "0".repeat(40) } }).returning();
    await f.db.insert(s.serviceCatalogLifecycle).values({ tenantId: "crc", catalogId: catalog.id, state: "active" });
    const pair = unitPair("morning");
    const [row] = await f.db.insert(s.honoreeMaterialRelease).values({ tenantId: "crc", catalogId: catalog.id, catalogIdentity: catalog.identity, slot: "morning", beforeId: pair[0], afterId: pair[1], materialVersion: syntheticMaterial.version, projectionDigest: digest(syntheticMaterial), approvalBasis: "synthetic fixture, never production approval", notices: syntheticMaterial.credits, state: "active" }).returning();
    return row;
  }) : null;
  const input = { db: f.db, access: f.runtime.access, origin: "http://localhost:3000", deployment: { environment: "test" as const, deployment: "suite" }, signingSecret: secret };
  const service = createHonoreeService({ ...input, projectMaterial: async () => syntheticMaterial });
  const intent = async (operation: "issue" | "revoke" | "reissue" = "issue", linkId: string | null = null, startVerse = "Genesis 1:1") => ({ operation, mutationId: randomUUID(), expectedVersion: (await f.read()).currentVersion, contextHash: (await f.read()).currentContext.hash, startVerse, linkId });
  const guest = (signal?: AbortSignal) => ({ url: "http://localhost:3000/api/honoree/read", headers: new Headers({ origin: "http://localhost:3000" }), method: "POST", signal });
  const issue = async (startVerse = "Genesis 1:1") => {
    const write = await intent("issue", null, startVerse), result = await service.mutate(f.req(), f.selected, write);
    if (!result.ok || !("url" in result) || !result.url) throw new Error("Synthetic issue failed");
    const token = new URLSearchParams(new URL(result.url).hash.slice(1)).get("token")!;
    return { write, result, token, id: token.split(".")[2] };
  };
  return { ...f, honoree: service, noProjector: createHonoreeService(input), materialRelease: release, form, guest, honoreeIntent: intent, issue };
}
