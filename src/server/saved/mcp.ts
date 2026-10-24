import "server-only";
import { createHash } from "node:crypto";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import { AccessDenied } from "../access/errors";
import type { AccessTransaction } from "../access/types";
import * as data from "../data/saved";
import type { createMcpAuthService, McpActor } from "../mcp/service";
import { withConnectionOwner, type SavedOwner } from "./access";
import { SAVED_CAPS } from "./service";
import * as validate from "./validation";

/**
 * What the MCP may do with saved readings (release 1.7 M4), and nothing more. Only src/server/mcp/saved-tools.ts imports
 * this module (a structural test holds this). Every call runs through withConnectionOwner, so the owner is the connection's
 * own membership; no input names an owner, a member or a student. A reading's notes, translations, marks and stars are
 * never read here: the views below carry its name, date, kind, ranges and counts only, and never a verse's text.
 */
type Mcp<Q extends PgQueryResultHKT> = Pick<ReturnType<typeof createMcpAuthService<Q>>, "withLive">;
export type McpSavedReading = Readonly<{ id: string; name: string; date: string | null; kind: "torah" | "haftarah"; ranges: string; verseCount: number; revision: number; createdAt: string; updatedAt: string }>;
export type McpSavedOutcome = Readonly<{ ok: true; reading: McpSavedReading; replayed?: boolean }> | Readonly<{ ok: false; code: "invalid"; problems: readonly string[] }>
  | Readonly<{ ok: false; code: "limit" }> | Readonly<{ ok: false; code: "conflict"; current: McpSavedReading }> | Readonly<{ ok: false; code: "no-change" }>;

export const MCP_SAVED_UUID_PATTERN = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";
export const MCP_SAVED_LIMIT = SAVED_CAPS.readings;

const view = (row: data.SavedReadingRow): McpSavedReading => Object.freeze({ id: row.id, name: row.name, date: row.readingDate, kind: row.kind as "torah" | "haftarah", ranges: row.ranges,
  verseCount: row.verseCount, revision: row.revision, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() });
const invalid = (problems: string[]): McpSavedOutcome => Object.freeze({ ok: false, code: "invalid", problems: Object.freeze(problems) });

/** One field through the saved layer's own validator; a failure becomes the plain problem given, never an echo of the input. */
function field<T>(problems: string[], parse: () => T, problem: string): T | undefined {
  try { return parse(); } catch { problems.push(problem); return undefined; }
}
const PROBLEMS = Object.freeze({
  id: "id must be the id of one of your saved readings, from list_saved_readings.",
  name: "name must be 1 to 80 characters, with no control characters.",
  date: "date must be a real date (YYYY-MM-DD) or null.",
  revision: "revision must be the reading's current revision, from your last read.",
  mutationId: "mutationId must be a fresh random UUID.",
  ranges: "ranges must be a Torah or Prophets selection in Hebcal's form: up to 32 segments joined by \"; \", in order, within one corpus and under 1,000 verses, e.g. \"Genesis 12:1-13\" or \"Genesis 1:1-5; Genesis 2:1-3\".",
});

/**
 * The id a create with this mutationId makes for this owner: SHA-256 over the owner and the mutationId, shaped as an
 * RFC 9562 version 8 UUID, as the consent request's connection id is (src/server/mcp/service.ts). A resend of the same
 * create finds that row under the owner's write lock and inserts nothing; no migration is needed. Another owner's
 * mutationId can never name this owner's id, because the owner is inside the hash.
 */
function createdId(owner: SavedOwner, mutationId: string) {
  const h = createHash("sha256").update(JSON.stringify(["mcp-saved-create/v1", owner.tenantId, owner.membershipId, mutationId])).digest();
  h[6] = (h[6] & 0x0f) | 0x80; h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

export function createMcpSavedReadings<Q extends PgQueryResultHKT>(mcp: Mcp<Q>) {
  const read = <T>(actor: McpActor, signal: AbortSignal, action: (tx: AccessTransaction<Q>, owner: SavedOwner) => Promise<T>) => withConnectionOwner<Q, T>(mcp, actor, "read", signal, action);
  // Every write takes the owner's write lock first, as the cookie entrance does: caps, revisions and replays see every earlier write.
  const write = <T>(actor: McpActor, signal: AbortSignal, action: (tx: AccessTransaction<Q>, owner: SavedOwner) => Promise<T>) =>
    withConnectionOwner<Q, T>(mcp, actor, "data-write", signal, async (tx, owner) => { await data.lockOwnerWrites(tx, owner); return action(tx, owner); });
  const own = async (tx: AccessTransaction<Q>, owner: SavedOwner, id: string) => {
    const row = await data.reading(tx, owner, id);
    // Missing, another member's and another congregation's readings are the same 404, whoever is asking.
    if (!row) throw new AccessDenied(404);
    return row;
  };

  return Object.freeze({
    async list(actor: McpActor, signal: AbortSignal) {
      return read(actor, signal, async (tx, owner) => {
        const rows = await data.listReadings(tx, owner, MCP_SAVED_LIMIT);
        return Object.freeze({ readings: Object.freeze(rows.map(view)), total: rows.length });
      });
    },
    async open(actor: McpActor, signal: AbortSignal, suppliedId: unknown): Promise<McpSavedOutcome> {
      const problems: string[] = [], id = field(problems, () => validate.uuid(suppliedId), PROBLEMS.id);
      if (id === undefined) return invalid(problems);
      return read(actor, signal, async (tx, owner) => Object.freeze({ ok: true as const, reading: view(await own(tx, owner, id)) }));
    },
    async create(actor: McpActor, signal: AbortSignal, supplied: Readonly<Record<string, unknown>>): Promise<McpSavedOutcome> {
      const problems: string[] = [];
      const name = field(problems, () => validate.name(supplied.name), PROBLEMS.name);
      const date = field(problems, () => validate.readingDate(supplied.date ?? null), PROBLEMS.date);
      const mutationId = field(problems, () => validate.uuid(supplied.mutationId), PROBLEMS.mutationId);
      // With kind, the ranges must be that corpus; without it, the corpus the ranges name.
      const ranges = field(problems, () => supplied.kind === undefined ? validate.revisedRanges(supplied.ranges)
        : { ...validate.savedRanges(supplied.ranges, validate.kind(supplied.kind)), kind: validate.kind(supplied.kind) }, PROBLEMS.ranges);
      if (problems.length || name === undefined || date === undefined || mutationId === undefined || ranges === undefined) return invalid(problems);
      return write(actor, signal, async (tx, owner) => {
        const id = createdId(owner, mutationId);
        const existing = await data.reading(tx, owner, id);
        if (existing) return Object.freeze({ ok: true as const, reading: view(existing), replayed: true });
        if (await data.countReadings(tx, owner) >= SAVED_CAPS.readings) return Object.freeze({ ok: false as const, code: "limit" as const });
        const row = await data.insertReading(tx, owner, { id, name, date, kind: ranges.kind, ranges: ranges.ranges, verseCount: ranges.verses.length });
        if (!row) throw new Error("Saved reading unavailable");
        return Object.freeze({ ok: true as const, reading: view(row) });
      });
    },
    /** Rename, re-date or revise the verses, with the revision from the caller's last read. Anything left out stays as it is. */
    async revise(actor: McpActor, signal: AbortSignal, supplied: Readonly<Record<string, unknown>>): Promise<McpSavedOutcome> {
      const problems: string[] = [];
      const id = field(problems, () => validate.uuid(supplied.id), PROBLEMS.id);
      const revision = field(problems, () => validate.integer(supplied.revision, 1, 2147483646), PROBLEMS.revision);
      const name = supplied.name === undefined ? undefined : field(problems, () => validate.name(supplied.name), PROBLEMS.name);
      const date = supplied.date === undefined ? undefined : field(problems, () => validate.readingDate(supplied.date), PROBLEMS.date);
      const ranges = supplied.ranges === undefined ? undefined : field(problems, () => validate.revisedRanges(supplied.ranges), PROBLEMS.ranges);
      if (problems.length || id === undefined || revision === undefined) return invalid(problems);
      if (supplied.name === undefined && supplied.date === undefined && supplied.ranges === undefined) return Object.freeze({ ok: false as const, code: "no-change" as const });
      return write(actor, signal, async (tx, owner) => {
        const current = await own(tx, owner, id);
        if (current.revision !== revision) return Object.freeze({ ok: false as const, code: "conflict" as const, current: view(current) });
        // A reading's kind never changes, as on the cookie route: Torah ranges cannot revise a haftarah reading, nor the reverse.
        if (ranges && ranges.kind !== current.kind) return invalid([`ranges must stay within this reading's corpus (${current.kind === "torah" ? "the Torah" : "the Prophets"}).`]);
        // The verse count is the server's own expansion of the canonical ranges. Work on verses a revision drops stays stored for its owner.
        const row = await data.updateReading(tx, owner, id, revision, { name: name ?? current.name, date: date === undefined ? current.readingDate : date,
          verses: ranges ? { ranges: ranges.ranges, verseCount: ranges.verses.length } : undefined });
        if (!row) throw new Error("Saved reading unavailable");
        return Object.freeze({ ok: true as const, reading: view(row) });
      });
    },
  });
}
