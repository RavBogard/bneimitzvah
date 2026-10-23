import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import { AccessDenied } from "../access/errors";
import type { createAccessService } from "../access/service";
import type { AccessRequest, AccessTransaction } from "../access/types";
import * as data from "../data/saved";
import { TANAKH_VERSE_COUNTS } from "../../lib/readings/catalog";
import { expandReadingRanges } from "../../lib/readings/ranges";
import { createSavedAccess } from "./access";
import type { SavedOwner } from "./access";
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
const starView = (row: data.StarRow) => ({ work: row.work, verseRef: row.verseRef, comment: row.commentIndex, starred: row.starred });

/** A stored reading re-expanded from its own canonical ranges; a row that no longer agrees is refused, never served. */
function versesOf(row: data.SavedReadingRow) {
  const verses = expandReadingRanges(row.ranges.split("; "), row.kind, TANAKH_VERSE_COUNTS, validate.SAVED_RANGE_LIMITS.verses);
  if (verses.length !== row.verseCount) throw new Error("Saved reading unavailable");
  return verses;
}

export function createSavedService<Q extends PgQueryResultHKT>(input: { access: Pick<ReturnType<typeof createAccessService<Q>>, "withVerifiedIdentity"> }) {
  const withSavedOwner = createSavedAccess<Q>(input);
  // Every write takes the member's write lock first: caps and version checks see every earlier write of this member.
  const write = <T>(request: Request, action: (tx: AccessTransaction<Q>, owner: SavedOwner) => Promise<T>) =>
    withSavedOwner<T>(request, "data-write", async (tx, owner) => { await data.lockOwnerWrites(tx, owner); return action(tx, owner); });
  const ownReading = async (tx: AccessTransaction<Q>, owner: SavedOwner, id: string) => {
    const row = await data.reading(tx, owner, id);
    // Missing, another member's and another congregation's readings are the same 404.
    if (!row) throw new AccessDenied(404);
    return row;
  };
  const requireVerse = (row: data.SavedReadingRow, verseRef: string) => { if (!versesOf(row).includes(verseRef)) throw new AccessDenied(404); };

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
        const row = await data.updateReading(tx, owner, value.id, value.revision, { name: value.name, date: value.date });
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
      return withSavedOwner(request, "read", async (tx, owner) => {
        const row = await ownReading(tx, owner, id), verses = versesOf(row);
        // Inside the access callback a boundary error would read as 503; a past-the-end page is a closed 400 result instead.
        if (offset >= verses.length) return { ok: false as const, code: "invalid-request" as const };
        const page = verses.slice(offset, offset + PAGE_VERSES);
        const work = await data.workForVerses(tx, owner, row.id, page), marks = await data.marksForVerses(tx, owner, row.id, page);
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
      });
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
    /** Stars belong to the member, not to a reading; turning one off keeps its row. */
    async star(request: Request, supplied: unknown) {
      const value = validate.star(supplied);
      return write(request, async (tx, owner) => {
        const current = await data.starRow(tx, owner, value.work, value.verseRef, value.comment);
        if (current) {
          const updated = await data.updateStar(tx, owner, value.work, value.verseRef, value.comment, value.starred);
          if (!updated) throw new Error("Saved star unavailable");
          return { ok: true as const, star: starView(updated) };
        }
        if (await data.countStars(tx, owner) >= SAVED_CAPS.stars) return limit;
        const inserted = await data.insertStar(tx, owner, value.work, value.verseRef, value.comment, value.starred);
        if (!inserted) throw new Error("Saved star unavailable");
        return { ok: true as const, star: starView(inserted) };
      });
    },
  });
}
export type SavedService = ReturnType<typeof createSavedService>;
