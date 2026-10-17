import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessRequest, AccessTransaction } from "../access/types";
import type { StudentView } from "../data/students";
import type { createAccessService } from "../access/service";
import type { createPracticeService } from "../practice/service";
import { AccessDenied } from "../access/errors";
import { confirmedReadings } from "../data/portal";
import { expandReadingRanges } from "../../lib/readings/ranges";
import { TANAKH_VERSE_COUNTS } from "../../lib/readings/catalog";
import { verifyPracticeServiceUnit } from "../service-learning/service";
import * as data from "../data/practice-calendar";
import * as validate from "./validation";
import { DAILY_DETAIL_LIMIT, retention, serverInstant } from "./policy";
import type { PracticeCalendarFailure, PracticeCalendarPage, PracticeDayAck, PracticeEventWrite, PracticeRawCursor, PracticeRawPage, PracticeSelection, PracticeWindow } from "../../lib/practice-calendar/types";

type Request = AccessRequest & { method?: string };
type FreshState = ReturnType<typeof retention> & { now: number };
// The authority boundary preserves AccessDenied subclasses while masking other
// exceptions. Keep this rollback signal private to record(), which translates
// it only after the capability transaction has rolled back.
class Fence extends AccessDenied { constructor(readonly code: PracticeCalendarFailure["code"]) { super(404); } }
export function createPracticeCalendarService<Q extends PgQueryResultHKT>(input: { access: ReturnType<typeof createAccessService<Q>>; practice: ReturnType<typeof createPracticeService<Q>>; now?: () => number }) {
  const now = input.now ?? Date.now;
  async function authorized<T>(request: Request, selection: PracticeSelection, write: PracticeEventWrite | null,
    action: (tx: AccessTransaction<Q>, actor: data.CalendarActor, student: StudentView, fresh: () => FreshState) => Promise<T>, project?: (result: T, state: FreshState) => T) {
    const run = async (tx: AccessTransaction<Q>, actor: data.CalendarActor, student: StudentView) => {
      const fresh = () => {
        // Policy clock is a trusted dependency, never a request field. Actual
        // session/context expiry remains bound to real time like existing services.
        const actual = Date.now();
        if (actor.authSessionExpiresAt <= actual) throw new AccessDenied(401);
        if ("context" in actor && actor.context && Date.parse(actor.context.expiresAt) <= actual) throw new AccessDenied(404);
        const instant = serverInstant(now()), state = retention(student.ceremonyDate, instant);
        if (write && state.expired) throw new Fence("retention-expired");
        if (write && state.serverDay !== write.expectedDay) throw new Fence("stale-day");
        return { ...state, now: instant };
      };
      fresh(); const result = await action(tx, actor, student, fresh), state = fresh(); return project ? project(result, state) : result;
    };
    if (write) {
      if (selection.mode !== "student" && selection.mode !== "child-practice") throw new AccessDenied(403);
      return input.practice.withPracticeCapability(request, { mode: selection.mode, studentId: selection.studentId, capability: "practice-write" }, run);
    }
    return selection.mode === "child-practice"
      ? input.practice.withPracticeCapability(request, { mode: selection.mode, studentId: selection.studentId, capability: "read" }, run)
      : input.access.withStudentCapability(request, { mode: selection.mode, studentId: selection.studentId, capability: "read" }, run);
  }
  return Object.freeze({
    async calendar(request: Request, supplied: PracticeSelection, suppliedWindow: PracticeWindow): Promise<PracticeCalendarPage> {
      const selection = validate.selection(supplied), window = validate.window(suppliedWindow);
      return authorized<PracticeCalendarPage>(request, selection, null, async (tx, actor, _student, fresh) => {
        let state = fresh();
        const rows = state.expired ? [] : await data.calendar(tx, actor, window); state = fresh();
        if (rows.length > 366) throw new Error("Practice calendar unavailable");
        return { ok: true, studentId: actor.studentId, mode: actor.mode, serverDay: state.serverDay, dates: state.expired ? [] : rows.filter(row => row.practiceDay <= state.serverDay).map(row => row.practiceDay) };
      }, (result, state) => ({ ...result, serverDay: state.serverDay, dates: state.expired ? [] : result.dates.filter(day => day <= state.serverDay) }));
    },
    async events(request: Request, supplied: PracticeSelection, suppliedCursor?: PracticeRawCursor): Promise<PracticeRawPage> {
      const selection = validate.selection(supplied), cursor = validate.cursor(suppliedCursor);
      if (selection.mode !== "student") throw new AccessDenied(403);
      return authorized<PracticeRawPage>(request, selection, null, async (tx, actor, _student, fresh) => {
        let state = fresh();
        const rows = state.expired ? [] : await data.events(tx, actor, state.rawAfter, new Date(state.now), cursor); state = fresh();
        const visible = state.expired ? [] : rows.filter(row => row.receivedAt.getTime() > state.rawAfter.getTime() && row.receivedAt.getTime() <= state.now);
        const page = visible.slice(0, 50), last = page.at(-1);
        return { ok: true, studentId: actor.studentId, mode: "student", events: page.map(row => ({ eventId: row.eventId, practiceDay: row.practiceDay, receivedAtISO: row.receivedAt.toISOString(), action: row.action, sourceMode: row.sourceMode, target: validate.target(row.target) })),
          nextCursor: visible.length > 50 && last ? { receivedAt: last.receivedAt.toISOString(), eventId: last.eventId } : null };
      }, (result, state) => {
        const events = state.expired ? [] : result.events.filter(row => Date.parse(row.receivedAtISO) > state.rawAfter.getTime() && Date.parse(row.receivedAtISO) <= state.now);
        return { ...result, events, nextCursor: state.expired || events.length !== result.events.length ? null : result.nextCursor };
      });
    },
    async record(request: Request, supplied: PracticeSelection, suppliedWrite: PracticeEventWrite): Promise<PracticeDayAck | PracticeCalendarFailure> {
      const selection = validate.selection(supplied), write = validate.write(suppliedWrite);
      try {
        return await authorized(request, selection, write, async (tx, actor, student, fresh) => {
          if (write.target.type === "verse") {
            const target = write.target, readings = await confirmedReadings(tx, actor.tenantId, actor.studentId); fresh();
            const row = readings.find(value => value.kind === target.kind);
            if (!row || row.id !== target.assignmentId || row.revision !== target.assignmentRevision) return { ok: false, code: "stale-material" };
            const refs = expandReadingRanges(row.ref.split(/;\s*/), target.kind, TANAKH_VERSE_COUNTS);
            if (refs.length !== row.verses.length || refs.some((ref, index) => ref !== row.verses[index])) throw new Error("Practice material unavailable");
            if (!refs.includes(target.verseRef)) return { ok: false, code: "stale-material" };
          } else {
            const eligible = await verifyPracticeServiceUnit(tx, actor, student, write.target, fresh); fresh();
            if (!eligible) return { ok: false, code: "stale-material" };
          }
          await data.ensureDay(tx, actor, write.expectedDay); fresh();
          await data.lockDay(tx, actor, write.expectedDay); fresh();
          const count = await data.countDay(tx, actor, write.expectedDay), state = fresh();
          if (count < DAILY_DETAIL_LIMIT) { await data.insertEvent(tx, actor, write, new Date(state.now)); fresh(); }
          return { ok: true, practiceDay: write.expectedDay };
        });
      } catch (error) {
        // Fence exceptions must leave the capability transaction first so all
        // provisional raw/date rows are rolled back before a conflict response.
        if (error instanceof Fence) return { ok: false, code: error.code };
        throw error;
      }
    },
  });
}
