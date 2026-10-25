import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { createAccessService } from "../access/service";
import type { AccessRequest } from "../access/types";
import * as data from "../data/verse-review";
import { parseVerseReview, type VerseReview } from "../../lib/learn/verse-review";
import { createVerseReviewAccess } from "./access";
import * as validate from "./validation";

/**
 * A student's own verse review cards (1.9 N19), on Learn progress's contract (plan, slice 3) and its own owner-only table.
 * There is no staff, parent, MCP or Sheet reader: the only reader is the student, through this service.
 */
type Request = AccessRequest & { method?: string };
/** A stored document re-read with the same parser; a row that no longer parses is refused, never served. */
function stored(row: data.VerseReviewRow): VerseReview {
  const value = parseVerseReview(row.review);
  if (!value) throw new Error("Verse review unavailable");
  return value;
}
const view = (row: data.VerseReviewRow | null, until: string | null) => ({ ok: true as const, review: row ? stored(row) : null, version: row?.version ?? 0, until });

export function createVerseReviewService<Q extends PgQueryResultHKT>(input: { access: Pick<ReturnType<typeof createAccessService<Q>>, "withVerifiedIdentity"> }) {
  const withOwner = createVerseReviewAccess<Q>(input);
  return Object.freeze({
    /** 401 signed out, 403 without a membership or a live student grant. */
    async get(request: Request) {
      return withOwner(request, "read", async (tx, owner) => view(await data.reviewRow(tx, owner), await data.ownCeremonyDate(tx, owner)));
    },
    /** Replace the document under its version; a stale version is a 409 conflict carrying the current one, which the browser merges. */
    async put(request: Request, supplied: unknown) {
      const value = validate.put(supplied);
      return withOwner(request, "data-write", async (tx, owner) => {
        await data.lockOwnerWrites(tx, owner);
        const current = await data.reviewRow(tx, owner), until = await data.ownCeremonyDate(tx, owner);
        if ((current?.version ?? 0) !== value.expectedVersion) return { ok: false as const, code: "conflict" as const, current: view(current, until) };
        const row = current ? await data.updateReview(tx, owner, value.expectedVersion, value.review) : await data.insertReview(tx, owner, value.review);
        if (!row) throw new Error("Verse review unavailable");
        return view(row, until);
      });
    },
  });
}
export type VerseReviewService = ReturnType<typeof createVerseReviewService>;
