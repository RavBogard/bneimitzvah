import { drizzle } from "drizzle-orm/pglite";
import { authFixture } from "./auth-stack-helper";
import * as s from "../../src/server/db/index";
import { createAccessService } from "../../src/server/access/service";
import type { AccessRequest } from "../../src/server/access/types";

export async function accessFixture() {
  const base = await authFixture();
  const db = drizzle(base.client, { schema: s });
  const identities = {} as Record<"admin" | "multi" | "learner", { id: string; cookie: string; sessionId: string }>;
  for (const name of ["admin", "multi", "learner"] as const) {
    const { cookie } = await base.signIn(`${name}@example.test`);
    const current = await base.auth.api.getSession({ headers: new Headers({ cookie }), query: { disableRefresh: true } });
    if (!current) throw new Error("Synthetic authenticated fixture setup failed");
    identities[name] = { id: current.user.id, cookie, sessionId: current.session.id };
  }
  await db.insert(s.tenant).values({ id: "other", name: "Synthetic other", productName: "Synthetic" });
  await db.insert(s.tenantHost).values([
    { host: "localhost:3000", tenantId: "crc", origin: "http://localhost:3000", environment: "test", deployment: "suite" },
    { host: "localhost:3101", tenantId: "other", origin: "http://localhost:3101", environment: "test", deployment: "suite" },
    { host: "preview-a.example.test", tenantId: "crc", origin: "https://preview-a.example.test", environment: "preview", deployment: "preview-a" },
  ]);
  const [adminMember] = await db.insert(s.membership).values({ tenantId: "crc", userId: identities.admin.id }).returning();
  const [multiMember] = await db.insert(s.membership).values({ tenantId: "crc", userId: identities.multi.id }).returning();
  const [learnerMember] = await db.insert(s.membership).values({ tenantId: "crc", userId: identities.learner.id }).returning();
  const [otherMember] = await db.insert(s.membership).values({ tenantId: "other", userId: identities.multi.id }).returning();
  const [adminGrant] = await db.insert(s.roleGrant).values({ tenantId: "crc", membershipId: adminMember.id, role: "admin" }).returning();
  const [parentGrant] = await db.insert(s.roleGrant).values({ tenantId: "crc", membershipId: multiMember.id, role: "parent" }).returning();
  const [tutorGrant] = await db.insert(s.roleGrant).values({ tenantId: "crc", membershipId: multiMember.id, role: "tutor" }).returning();
  const [learnerGrant] = await db.insert(s.roleGrant).values({ tenantId: "crc", membershipId: learnerMember.id, role: "student" }).returning();
  const [otherGrant] = await db.insert(s.roleGrant).values({ tenantId: "other", membershipId: otherMember.id, role: "student" }).returning();
  const students = await db.insert(s.student).values([
    { tenantId: "crc", firstName: "Synthetic", lastName: "Sibling A", ceremonyDate: "2027-01-02", parentEmail: "shared@example.test" },
    { tenantId: "crc", firstName: "Synthetic", lastName: "Sibling B", ceremonyDate: "2027-01-02", parentEmail: "shared@example.test" },
    { tenantId: "crc", firstName: "Synthetic", lastName: "Unrelated", ceremonyDate: "2027-01-02", parentEmail: "unrelated@example.test" },
    { tenantId: "other", firstName: "Synthetic", lastName: "Other", ceremonyDate: "2027-01-02", parentEmail: "other@example.test" },
  ]).returning();
  const guardians = await db.insert(s.guardian).values([0, 1].map((index) => ({ tenantId: "crc", studentId: students[index].id, parentGrantId: parentGrant.id, linkProvenance: "synthetic" }))).returning();
  const [tutorLink] = await db.insert(s.tutorStudent).values({ tenantId: "crc", studentId: students[0].id, tutorGrantId: tutorGrant.id }).returning();
  const [learnerLink] = await db.insert(s.studentIdentity).values({ tenantId: "crc", studentId: students[0].id, roleGrantId: learnerGrant.id }).returning();
  await db.insert(s.studentIdentity).values({ tenantId: "other", studentId: students[3].id, roleGrantId: otherGrant.id });

  async function restrict() { await base.client.exec("SET SESSION AUTHORIZATION access_login; SET ROLE portal_runtime"); }
  await base.client.exec("CREATE ROLE access_login LOGIN; GRANT portal_runtime TO access_login");
  await restrict();
  // PGlite-only owner fixture maintenance; not exposed by any application API.
  async function owner<T>(action: () => Promise<T>) {
    await base.client.exec("RESET ROLE; SET SESSION AUTHORIZATION postgres");
    try { return await action(); } finally { await restrict(); }
  }
  function request(who: keyof typeof identities, origin = "http://localhost:3000", extra: Record<string, string> = {}): AccessRequest {
    return { url: `${origin}/students`, headers: new Headers({ cookie: identities[who].cookie, ...extra }) };
  }
  const service = createAccessService({ db, auth: base.auth, deployment: { environment: "test", deployment: "suite" } });
  return { ...base, db, identities, adminMember, multiMember, learnerMember, adminGrant, parentGrant, tutorGrant, learnerGrant,
    students, guardians, tutorLink, learnerLink, service, request, owner };
}
