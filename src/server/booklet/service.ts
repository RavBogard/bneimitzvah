import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import { AccessDenied } from "../access/errors";
import type { createAccessService } from "../access/service";
import type { AccessRequest } from "../access/types";
import { bookletMode, bookletTutorName, type BookletMode } from "./access";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type BookletOpening = Readonly<{ mode: BookletMode; tutor: string | null }>;

/**
 * Opens a student's study booklet: which of the viewer's own modes the booklet reads through, and the tutor's name for the cover.
 * Everything else the booklet prints comes through the reads that mode already has (the reading, the text, the guide, the service plan),
 * each with its own checks. Signed out, no membership, a guessed or foreign id, or a viewer the rule refuses: one 404 for all.
 */
export function createBookletService<Q extends PgQueryResultHKT>(input: { access: Pick<ReturnType<typeof createAccessService<Q>>, "withVerifiedIdentity"> }) {
  async function open(request: AccessRequest, studentId: string): Promise<BookletOpening> {
    if (!UUID.test(studentId)) throw new AccessDenied(404);
    try {
      return await input.access.withVerifiedIdentity(request, { intent: "read" }, async (tx, identity) => {
        if (!identity.membership) throw new AccessDenied(404);
        const mode = await bookletMode(tx, identity.tenantId, identity.membership.id, studentId);
        if (!mode) throw new AccessDenied(404);
        return Object.freeze({ mode, tutor: mode === "parent" ? null : await bookletTutorName(tx, identity.tenantId, studentId) });
      });
    } catch (error) {
      if (error instanceof AccessDenied) throw new AccessDenied(404);
      throw error;
    }
  }
  return Object.freeze({ open });
}
export type BookletService = ReturnType<typeof createBookletService>;
