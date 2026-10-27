import "server-only";
import { createHash } from "node:crypto";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import { parseStoredPreferences, serializePreferences } from "../../lib/account-preferences/document";
import { AccessDenied } from "../access/errors";
import type { createAccessService } from "../access/service";
import type { AccessRequest, AccessTransaction } from "../access/types";
import * as data from "../data/saved";
import { TANAKH_VERSE_COUNTS } from "../../lib/readings/catalog";
import { expandReadingRanges } from "../../lib/readings/ranges";
import { createSavedAccess, createSavedViewerAccess } from "./access";
import type { SavedOwner, SavedScope } from "./access";
import * as validate from "./validation";

/** Per-member caps (accounts plan §2a), checked under the member's write lock. Over a cap is 409 `limit`. */
export const SAVED_CAPS = Object.freeze({ readings: 100, work: 3000, marks: 10000, stars: 2000 });
const PAGE_VERSES = 10, PAGE_BYTES = 240 * 1024;
const limit = { ok: false as const, code: "limit" as const };
type Request = AccessRequest & { method?: string };

const readingView = (row: data.SavedReadingRow) => ({ id: row.id, name: row.name, date: row.readingDate, kind: row.kind, ranges: row.ranges,
  verseCount: row.verseCount, revision: row.revision, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
const workView = (row: data.WorkRow) => ({ text: row.text, version: row.version, updatedAt: row.updatedAt.toISOString() });
const markView = (row: data.MarkRow) => ({ state: row.state, version: row.version, updatedAt: row.updatedAt.toISOString() });
const starView = (row: data.StarRow) => ({ work: row.work, verseRef: row.verseRef, comment: row.commentIndex });

/**
 * An opaque, stable name for this member's account, so a browser can tell whose preferences it holds (a shared device
 * never copies one member's choices up into another's account). A hash, not an id, returned only to the member themself.
 */
export const preferencesOwnerName = (owner: Pick<SavedOwner, "tenantId" | "membershipId">) =>
  createHash("sha256").update(`account-preferences-owner/v1:${owner.tenantId}:${owner.membershipId}`).digest("hex").slice(0, 32);
/** A stored document re-read with the same strict parser; a row that no longer parses is refused, never served. */
function preferencesView(owner: SavedOwner, row: data.PreferenceRow | null) {
  const preferences = row ? parseStoredPreferences(row.preferences) : null;
  if (row && !preferences) throw new Error("Preferences unavailable");
  return { ok: true as const, owner: preferencesOwnerName(owner), preferences, revision: row?.revision ?? 0 };
}

/** A stored reading re-expanded from its own canonical ranges; a row that no longer agrees is refused, never served. */
function versesOf(row: data.SavedReadingRow) {
  const verses = expandReadingRanges(row.ranges.split("; "), row.kind, TANAKH_VERSE_COUNTS, validate.SAVED_RANGE_LIMITS.verses);
  if (verses.length !== row.verseCount) throw new Error("Saved reading unavailable");
  return verses;
}

export function createSavedService<Q extends PgQueryResultHKT>(input: { access: Pick<ReturnType<typeof createAccessService<Q>>, "withVerifiedIdentity"> }) {
  const withSavedOwner = createSavedAccess<Q>(input);
  // Readings for everyone (plan D4): the read-only staff path to a learner's shelf, and the directory's counts.
  const { withSavedViewer, withDirectory } = createSavedViewerAccess<Q>(input);
  // Every write takes the member's write lock first: caps and version checks see every earlier write of this member.
  const write = <T>(request: Request, action: (tx: AccessTransaction<Q>, owner: SavedOwner) => Promise<T>) =>
    withSavedOwner<T>(request, "data-write", async (tx, owner) => { await data.lockOwnerWrites(tx, owner); return action(tx, owner); });
  const ownReading = async (tx: AccessTransaction<Q>, owner: SavedScope, id: string) => {
    const row = await data.reading(tx, owner, id);
    // Missing, another member's and another congregation's readings are the same 404.
    if (!row) throw new AccessDenied(404);
    return row;
  };
  const requireVerse = (row: data.SavedReadingRow, verseRef: string) => { if (!versesOf(row).includes(verseRef)) throw new AccessDenied(404); };
  /** The reading plus up to ten verses from `offset`, each with the scope's translation, note and mark: the owner's own page, or a bound viewer's read of a learner's. */
  const pageOf = async (tx: AccessTransaction<Q>, scope: SavedScope, id: string, offset: number) => {
    const row = await ownReading(tx, scope, id), verses = versesOf(row);
    // Inside the access callback a boundary error would read as 503; a past-the-end page is a closed 400 result instead.
    if (offset >= verses.length) return { ok: false as const, code: "invalid-request" as const };
    const page = verses.slice(offset, offset + PAGE_VERSES);
    const work = await data.workForVerses(tx, scope, row.id, page), marks = await data.marksForVerses(tx, scope, row.id, page);
    const rows: { ref: string; translation: ReturnType<typeof workView> | null; note: ReturnType<typeof workView> | null; mark: ReturnType<typeof markView> | null }[] = [];
    for (const ref of page) {
      const find = (stream: validate.WorkStream) => work.find(item => item.verseRef === ref && item.stream === stream);
      const translation = find("translation"), note = find("note"), mark = marks.find(item => item.verseRef === ref);
      const entry = { ref, translation: translation ? workView(translation) : null, note: note ? workView(note) : null, mark: mark ? markView(mark) : null };
      // Keep a page inside the transport bound by stopping at a verse boundary.
      if (rows.length && Buffer.byteLength(JSON.stringify([...rows, entry])) > PAGE_BYTES) break;
      rows.push(entry);
    }
    return { ok: true as const, reading: readingView(row), offset, totalVerses: verses.length,
      nextOffset: offset + rows.length < verses.length ? offset + rows.length : null, verses: rows };
  };

  return Object.freeze({
    /** 401 signed out, 403 not eligible: the client learns its own state from this. */
    async list(request: Request) {
      return withSavedOwner(request, "read", async (tx, owner) =>
        ({ ok: true as const, readings: (await data.listReadings(tx, owner, SAVED_CAPS.readings)).map(readingView) }));
    },
    async create(request: Request, supplied: unknown) {
      const value = validate.create(supplied);
      return write(request, async (tx, owner) => {
        if (await data.countReadings(tx, owner) >= SAVED_CAPS.readings) return limit;
        const row = await data.insertReading(tx, owner, { name: value.name, date: value.date, kind: value.kind, ranges: value.ranges, verseCount: value.verses.length });
        return { ok: true as const, reading: readingView(row) };
      });
    },
    async update(request: Request, supplied: unknown) {
      const value = validate.update(supplied);
      return write(request, async (tx, owner) => {
        const current = await ownReading(tx, owner, value.id);
        if (current.revision !== value.revision) return { ok: false as const, code: "conflict" as const, current: readingView(current) };
        // A reading's kind never changes: Torah ranges cannot revise a haftarah reading, nor the reverse. A closed 400 result,
        // because inside the access callback a boundary error would read as 503.
        if (value.ranges && value.ranges.kind !== current.kind) return { ok: false as const, code: "invalid-request" as const };
        // The verse count is always the server's own expansion of the canonical ranges, never a client's number. Translations,
        // notes and marks on verses a revision drops stay stored (keyed by reading and verse) and show again if the verse returns.
        const verses = value.ranges ? { ranges: value.ranges.ranges, verseCount: value.ranges.verses.length } : undefined;
        const row = await data.updateReading(tx, owner, value.id, value.revision, { name: value.name, date: value.date, verses });
        if (!row) throw new Error("Saved reading unavailable");
        return { ok: true as const, reading: readingView(row) };
      });
    },
    async remove(request: Request, supplied: unknown) {
      const value = validate.remove(supplied);
      return write(request, async (tx, owner) => {
        const current = await ownReading(tx, owner, value.id);
        if (current.revision !== value.revision) return { ok: false as const, code: "conflict" as const, current: readingView(current) };
        if (!await data.deleteReading(tx, owner, value.id, value.revision)) throw new Error("Saved reading unavailable");
        return { ok: true as const, removed: value.id };
      });
    },
    /** The reading plus up to ten verses from `offset`, each with the member's translation, note and mark. */
    async reading(request: Request, suppliedId: unknown, suppliedOffset: unknown) {
      const id = validate.uuid(suppliedId), offset = validate.integer(suppliedOffset, 0, 999);
      return withSavedOwner(request, "read", (tx, owner) => pageOf(tx, owner, id, offset));
    },
    /**
     * Readings for everyone (plan D4, D5): a learner's shelf as a staff viewer sees it, read-only, the same bodies as the owner's
     * own list and page. The learner is bound by withSavedViewer only after canView; a learner the viewer may not see, a missing one
     * and another congregation's are the same 404. Nothing on this path can write: the owner is never bound here.
     */
    async listReadingsOf(request: Request, learner: unknown) {
      const learnerMembershipId = validate.uuid(learner);
      return withSavedViewer(request, learnerMembershipId, async (tx, scope) => ({ ok: true as const, readings: (await data.listReadings(tx, scope, SAVED_CAPS.readings)).map(readingView) }));
    },
    async readingOf(request: Request, learner: unknown, suppliedId: unknown) {
      const learnerMembershipId = validate.uuid(learner), id = validate.uuid(suppliedId);
      return withSavedViewer(request, learnerMembershipId, (tx, scope) => pageOf(tx, scope, id, 0));
    },
    async pageOf(request: Request, learner: unknown, suppliedId: unknown, suppliedOffset: unknown) {
      const learnerMembershipId = validate.uuid(learner), id = validate.uuid(suppliedId), offset = validate.integer(suppliedOffset, 0, 999);
      return withSavedViewer(request, learnerMembershipId, (tx, scope) => pageOf(tx, scope, id, offset));
    },
    /** The directory's counts and nearest dates for every membership that keeps a reading (plan D5), for a live admin or tutor; the learners service adds the names. */
    async directory(request: Request) {
      return withDirectory(request, async (tx, actor) => ({ ok: true as const, actor, rows: await data.directoryRows(tx, actor.tenantId) }));
    },
    async work(request: Request, supplied: unknown) {
      const value = validate.work(supplied);
      return write(request, async (tx, owner) => {
        const row = await ownReading(tx, owner, value.readingId);
        requireVerse(row, value.verseRef);
        const current = await data.workRow(tx, owner, row.id, value.verseRef, value.stream);
        if ((current?.version ?? 0) !== value.expectedVersion) return { ok: false as const, code: "conflict" as const, current: current ? workView(current) : null };
        if (!current) {
          if (await data.countWork(tx, owner) >= SAVED_CAPS.work) return limit;
          const inserted = await data.insertWork(tx, owner, row.id, value.verseRef, value.stream, value.text);
          if (!inserted) throw new Error("Saved work unavailable");
          return { ok: true as const, verseRef: value.verseRef, stream: value.stream, work: workView(inserted) };
        }
        const updated = await data.updateWork(tx, owner, current.id, value.expectedVersion, value.text);
        if (!updated) throw new Error("Saved work unavailable");
        return { ok: true as const, verseRef: value.verseRef, stream: value.stream, work: workView(updated) };
      });
    },
    async mark(request: Request, supplied: unknown) {
      const value = validate.mark(supplied);
      return write(request, async (tx, owner) => {
        const row = await ownReading(tx, owner, value.readingId);
        requireVerse(row, value.verseRef);
        const current = await data.markRow(tx, owner, row.id, value.verseRef);
        if ((current?.version ?? 0) !== value.expectedVersion) return { ok: false as const, code: "conflict" as const, current: current ? markView(current) : null };
        if (!current) {
          if (await data.countMarks(tx, owner) >= SAVED_CAPS.marks) return limit;
          const inserted = await data.insertMark(tx, owner, row.id, value.verseRef, value.state);
          if (!inserted) throw new Error("Saved mark unavailable");
          return { ok: true as const, verseRef: value.verseRef, mark: markView(inserted) };
        }
        const updated = await data.updateMark(tx, owner, current.id, value.expectedVersion, value.state);
        if (!updated) throw new Error("Saved mark unavailable");
        return { ok: true as const, verseRef: value.verseRef, mark: markView(updated) };
      });
    },
    /** Every comment the member has starred, capped. */
    async stars(request: Request) {
      return withSavedOwner(request, "read", async (tx, owner) => ({ ok: true as const, stars: (await data.listStars(tx, owner, SAVED_CAPS.stars)).map(starView) }));
    },
    /** Stars belong to the member, not to a reading. Starring is idempotent; unstarring deletes the row, so the cap counts live stars only. */
    async star(request: Request, supplied: unknown) {
      const value = validate.star(supplied);
      const star = { work: value.work, verseRef: value.verseRef, comment: value.comment, starred: value.starred };
      return write(request, async (tx, owner) => {
        if (!value.starred) { await data.deleteStar(tx, owner, value.work, value.verseRef, value.comment); return { ok: true as const, star }; }
        if (await data.starRow(tx, owner, value.work, value.verseRef, value.comment)) return { ok: true as const, star };
        if (await data.countStars(tx, owner) >= SAVED_CAPS.stars) return limit;
        if (!await data.insertStar(tx, owner, value.work, value.verseRef, value.comment)) throw new Error("Saved star unavailable");
        return { ok: true as const, star };
      });
    },
    /**
     * The member's own reading preferences (release 1.7 M3b): `preferences` null and revision 0 when the account
     * keeps none yet. 401 signed out, 403 not eligible: the browser keeps its own copy then.
     */
    async preferences(request: Request) {
      return withSavedOwner(request, "read", async (tx, owner) => preferencesView(owner, await data.preferenceRow(tx, owner)));
    },
    /**
     * Replace the document under its revision. A stale revision (another device wrote first, or a first copy-up found
     * one already there), or an owner name that is not this member's (the browser read another account), is a 409
     * conflict carrying the member's own current document; the browser decides what to resend.
     */
    async putPreferences(request: Request, supplied: unknown) {
      const value = validate.preferencesPut(supplied), document = JSON.parse(serializePreferences(value.preferences));
      return write(request, async (tx, owner) => {
        const current = await data.preferenceRow(tx, owner);
        if (value.owner !== preferencesOwnerName(owner) || (current?.revision ?? 0) !== value.expectedRevision)
          return { ok: false as const, code: "conflict" as const, current: preferencesView(owner, current) };
        const row = current ? await data.updatePreferences(tx, owner, value.expectedRevision, document) : await data.insertPreferences(tx, owner, document);
        if (!row) throw new Error("Preferences unavailable");
        return preferencesView(owner, row);
      });
    },
  });
}
export type SavedService = ReturnType<typeof createSavedService>;
