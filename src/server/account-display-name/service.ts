import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import { AccessDenied, AccessUnavailable } from "../access/errors";
import type { createAccessService } from "../access/service";
import type { AccessRequest, AccessTransaction } from "../access/types";
import { ACCOUNT_CONTROLS, name as accountName, shownName } from "../accounts/validation";
import { lockRoleGrant } from "../data/authority";
import * as s from "../db/index";
import { closedObject } from "../http/query";
import { HttpBoundaryError } from "../http/responses";
import { matchesSessionBinding } from "../portal/session-summary";
import { subjectGrant } from "../relationships/data";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const displayNameTargets = ["membershipId", "tutorGrantId"] as const;
type Target = { type: "self" } | { type: "membershipId" | "tutorGrantId"; id: string };
type Request = AccessRequest & { method?: string };

function targetOf(row: Record<string, unknown>): Target {
  const selected = displayNameTargets.filter(field => Object.hasOwn(row, field));
  if (selected.length === 0) return { type: "self" };
  const type = selected[0], id = row[type];
  if (selected.length !== 1 || typeof id !== "string" || !uuid.test(id)) throw new HttpBoundaryError();
  return { type, id };
}

function editName(value: unknown) {
  if (typeof value !== "string" || ACCOUNT_CONTROLS.test(value) || /[<>@]/.test(value)) throw new HttpBoundaryError();
  return accountName(value.replace(/\s+/gu, " "));
}

function legacyPersonalName(value: string | null) {
  const name = shownName(value);
  return name === "Portal member" || /[<>]/.test(name) || !/\p{L}/u.test(name) ? "" : name;
}

export function createAccountDisplayNameService<Q extends PgQueryResultHKT>(input: {
  access: Pick<ReturnType<typeof createAccessService<Q>>, "withVerifiedIdentity">;
  sessionBindingSecret: string;
}) {
  if (typeof input.sessionBindingSecret !== "string" || input.sessionBindingSecret.length < 32) throw new AccessUnavailable();

  async function authorized<T>(request: Request, target: Target, write: boolean, action: (tx: AccessTransaction<Q>, scope: { tenantId: string; membershipId: string; legacyName: string }) => Promise<T>) {
    const intent = write ? "data-write" : "read";
    return input.access.withVerifiedIdentity(request, { intent, mutation: write }, async (tx, identity) => {
      if (!identity.membership || !await matchesSessionBinding(tx, identity, request.headers.get("X-Session-Binding"), input.sessionBindingSecret)) throw new AccessDenied(403);
      const { tenantId } = identity;
      let membershipId = identity.membership.id;
      if (target.type !== "self") {
        if (!await lockRoleGrant(tx, tenantId, membershipId, "admin", intent)) throw new AccessDenied(403);
        if (target.type === "tutorGrantId") {
          const { membership, grant, verified } = await subjectGrant(tx, tenantId, target.id, intent);
          if (grant.role !== "tutor" || grant.revokedAt || membership.disabledAt || !verified) throw new AccessDenied(404);
          membershipId = membership.id;
        } else {
          membershipId = target.id;
        }
      }
      const [member] = await tx.select({ name: s.user.name }).from(s.membership)
        .innerJoin(s.user, eq(s.user.id, s.membership.userId))
        .where(and(eq(s.membership.tenantId, tenantId), eq(s.membership.id, membershipId), isNull(s.membership.disabledAt))).for("share", { of: s.membership });
      if (!member) throw new AccessDenied(404);

      let legacyName = "";
      if (!write) {
        // Tutors previously used the auth account name. People and Account prefer an active Member label.
        const [label] = target.type === "tutorGrantId" ? [] : await tx.select({ name: s.tenantMember.displayName }).from(s.tenantMember)
          .where(and(eq(s.tenantMember.tenantId, tenantId), eq(s.tenantMember.membershipId, membershipId), isNull(s.tenantMember.revokedAt)));
        legacyName = legacyPersonalName(label?.name ?? null) || legacyPersonalName(member.name);
      }
      return action(tx, { tenantId, membershipId, legacyName });
    });
  }

  return Object.freeze({
    read(request: Request, query: unknown) {
      const target = targetOf(closedObject(query, [], displayNameTargets));
      return authorized(request, target, false, async (tx, { tenantId, membershipId, legacyName }) => {
        const [row] = await tx.select({ name: s.accountDisplayName.name, revision: s.accountDisplayName.revision }).from(s.accountDisplayName)
          .where(and(eq(s.accountDisplayName.tenantId, tenantId), eq(s.accountDisplayName.membershipId, membershipId)));
        return { ok: true as const, name: row?.name ?? legacyName, revision: row?.revision ?? 0 };
      });
    },
    write(request: Request, supplied: unknown) {
      const body = closedObject(supplied, ["name", "expectedRevision"], displayNameTargets);
      const target = targetOf(body);
      const name = editName(body.name);
      const revision = body.expectedRevision;
      if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0 || revision >= 2_147_483_647) throw new HttpBoundaryError();
      return authorized(request, target, true, async (tx, { tenantId, membershipId }) => {
        const table = s.accountDisplayName;
        const projection = { name: table.name, revision: table.revision };
        const [row] = revision === 0
          ? await tx.insert(table).values({ tenantId, membershipId, name }).onConflictDoNothing().returning(projection)
          : await tx.update(table).set({ name, revision: sql`${table.revision} + 1` })
            .where(and(eq(table.tenantId, tenantId), eq(table.membershipId, membershipId), eq(table.revision, revision))).returning(projection);
        return row ? { ok: true as const, ...row } : { ok: false as const, code: "changed" as const };
      });
    },
  });
}
