import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import { AccessDenied } from "../access/errors";
import type { createAccessService } from "../access/service";
import type { AccessRequest } from "../access/types";
import { currentLinkForStudent, MAVEN_NAMESPACE, unlinkSourceIdentity } from "../data/roster-source";

export type MavenLinkView = Readonly<{ mavenContactId: string; linkKind: "created" | "linked"; linkedAt: string }>;
export type MavenUnlinkResult = Readonly<{ ok: true; unlinkedAt: string }> | Readonly<{ ok: false; code: "not-linked" }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONTACT = /^[A-Za-z0-9]{18}$/;
const studentIdOf = (value: unknown) => { if (typeof value !== "string" || !UUID.test(value)) throw new AccessDenied(404); return value; };

/**
 * The roster's view of a student's Maven link, and the admin's undo of a wrong one (release 1.1). The same unlink the
 * MCP's unlink_maven_record runs, here under the portal's admin student authority (manage-students, as for editing a
 * student): the student record is unchanged; the link row is stamped revoked once and audited.
 */
export function createMavenLinkService<Q extends PgQueryResultHKT>(input: { access: Pick<ReturnType<typeof createAccessService<Q>>, "withAdminCapability">; now?: () => number }) {
  const now = input.now ?? Date.now;
  return Object.freeze({
    async read(request: AccessRequest, studentId: unknown): Promise<MavenLinkView | null> {
      const id = studentIdOf(studentId);
      return input.access.withAdminCapability(request, { mode: "admin", capability: "read-relationships" }, async (tx, actor) => {
        const link = await currentLinkForStudent(tx, actor.tenantId, MAVEN_NAMESPACE, id);
        return link ? Object.freeze({ mavenContactId: link.sourceRecordId, linkKind: link.linkKind, linkedAt: link.createdAt.toISOString() }) : null;
      });
    },
    async unlink(request: AccessRequest, body: { studentId: unknown; mavenContactId: unknown }): Promise<MavenUnlinkResult> {
      const id = studentIdOf(body.studentId);
      if (typeof body.mavenContactId !== "string" || !CONTACT.test(body.mavenContactId)) throw new AccessDenied(404);
      const contact = body.mavenContactId;
      return input.access.withAdminCapability(request, { mode: "admin", capability: "manage-students" }, async (tx, actor) => {
        const result = await unlinkSourceIdentity(tx, { tenantId: actor.tenantId, userId: actor.userId, membershipId: actor.membershipId, roleGrantId: actor.roleGrantId, channel: "web", mcpConnectionId: null },
          { namespace: MAVEN_NAMESPACE, studentId: id, sourceRecordId: contact }, new Date(now()));
        return result.ok ? Object.freeze({ ok: true as const, unlinkedAt: result.unlinkedAt }) : Object.freeze({ ok: false as const, code: "not-linked" as const });
      });
    },
  });
}
