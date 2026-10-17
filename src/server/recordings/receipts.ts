import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { AccessTransaction } from "../access/types";
import { AccessDenied, AccessUnavailable } from "../access/errors";
import type { RecordingSelection } from "../../lib/recordings/types";
import type { StudentView } from "../data/students";
import type { RecordingActor } from "../data/recordings";
import * as data from "../data/recording-receipts";
import * as validate from "./receipt-validation";
import { createRecordingAuthority, type RecordingDependencies, type RecordingFreshness, type RecordingRequest } from "./authority";

export class RecordingReceiptConflict extends Error { readonly code = "conflict"; constructor() { super("Recording receipt conflict"); this.name = "RecordingReceiptConflict"; } }
export class RecordingReceiptLimit extends Error { readonly code = "limit"; constructor() { super("Recording receipt limit reached"); this.name = "RecordingReceiptLimit"; } }
export type ReceiptView = ReturnType<typeof view>;
declare const openingBrand: unique symbol;
export type CommittedReceiptOpening = Readonly<{ [openingBrand]: true }>;
function view(row: data.ReceiptRow, slots: data.SlotRow[]) {
  return Object.freeze({ receiptId: row.id, requestId: row.requestId, originalRecordingId: row.originalRecordingId, assetId: row.assetId,
    declaredBytes: row.declaredBytes, state: row.state, revision: row.revision,
    slots: Object.freeze([...slots].sort((a, b) => a.slotIndex - b.slotIndex).map(slot => Object.freeze({ slotIndex: slot.slotIndex, objectKey: slot.objectKey, expectedBytes: slot.expectedBytes, state: slot.state, revision: slot.revision }))) });
}
function binding(actor: RecordingActor, student: StudentView): data.Binding {
  if ((actor.mode !== "student" && actor.mode !== "child-practice") || !actor.relationshipId) throw new AccessUnavailable();
  const context = "context" in actor ? actor.context : null;
  if (actor.mode === "child-practice" && !context || actor.mode === "student" && context) throw new AccessUnavailable();
  return { actorUserId: actor.userId, authSessionId: actor.authSessionId, membershipId: actor.membershipId, membershipAuthorityRevision: actor.authorityRevision,
    roleGrantId: actor.roleGrantId, roleGrantRevision: actor.roleGrantRevision, mode: actor.mode, relationshipId: actor.relationshipId, relationshipRevision: actor.relationshipRevision,
    contextId: context?.id ?? null, contextAuthorityRevision: context?.authorityRevision ?? null, contextStudentRevision: context?.studentRevision ?? null,
    studentRevision: student.revision, sessionExpiresAt: new Date(actor.authSessionExpiresAt), contextExpiresAt: context ? new Date(context.expiresAt) : null };
}
function matches(row: data.ReceiptRow, expected: data.Binding, store: string) {
  return row.storeGeneration === store && (Object.keys(expected) as (keyof data.Binding)[]).every(key => {
    const a = row[key], b = expected[key]; return a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b;
  });
}
function withinLimits(m: Awaited<ReturnType<typeof data.aggregates>>, bytes: number) {
  return m.studentActive + 1n <= 2n && m.actorActive + 1n <= 2n && m.tenantActive + 1n <= 128n
    && m.studentHour + 1n <= 4n && m.actorHour + 1n <= 4n && m.tenantHour + 1n <= 200n
    && m.studentDay + 1n <= 8n && m.actorDay + 1n <= 8n && m.tenantDay + 1n <= 512n
    && m.studentBytes + BigInt(bytes) <= 10n * 1024n ** 3n && m.tenantBytes + BigInt(bytes) <= 256n * 1024n ** 3n
    && m.studentTakes + 1n <= 1000n && m.tenantTakes + 1n <= 20000n && m.studentIds + 1n <= 4096n && m.tenantIds + 1n <= 65536n;
}

/** Internal provider-disabled service. No runtime/HTTP composition or sender. */
export function createRecordingReceiptService<Q extends PgQueryResultHKT>(input: RecordingDependencies<Q> & { storeGeneration: string }) {
  const generation = validate.storeGeneration(input.storeGeneration), authorized = createRecordingAuthority(input);
  const permissions = new WeakMap<object, { fresh: RecordingFreshness; value: Readonly<{ receiptId: string; originalRecordingId: string; assetId: string; slotIndex: number; objectKey: string; expectedBytes: number; bodySha256: string; permitEtag: string; operationId: string }> }>();
  async function authority<T>(request: RecordingRequest, selection: RecordingSelection, allowDue: boolean,
    action: (tx: AccessTransaction<Q>, actor: RecordingActor, student: StudentView, fresh: RecordingFreshness, conflict: AccessDenied, limit: AccessDenied) => Promise<T>) {
    const conflict = new AccessDenied(404), limit = new AccessDenied(404); let after: RecordingFreshness | undefined;
    try {
      const value = await authorized(request, selection, true, allowDue, async (tx, actor, student, fresh) => {
        after = fresh; return action(tx, actor, student, fresh, conflict, limit);
      });
      // This line runs only AFTER the complete outer authority transaction,
      // including deferred SQL constraints and COMMIT, has acknowledged success.
      if (!after) throw new AccessUnavailable(); after(); return { value, fresh: after };
    } catch (error) { if (error === conflict) throw new RecordingReceiptConflict(); if (error === limit) throw new RecordingReceiptLimit(); if (error instanceof AccessDenied || error instanceof AccessUnavailable) throw error; throw new AccessUnavailable(); }
  }
  async function locked(tx: AccessTransaction<Q>, actor: RecordingActor, student: StudentView, id: string, fresh: RecordingFreshness, conflict: AccessDenied) {
    await data.mutex(tx, actor.tenantId, fresh);
    const hint = await data.hint(tx, actor.tenantId, id); fresh();
    if (!hint || hint.studentId !== actor.studentId) throw new AccessDenied(404);
    const collision = await data.existingLedger(tx, hint); fresh(); if (collision) throw conflict;
    const row = await data.lock(tx, actor.tenantId, id, actor.studentId); fresh();
    if (!row || !matches(row, binding(actor, student), generation)) throw new AccessDenied(404);
    const slots = await data.slots(tx, row); fresh(); return { row, slots };
  }
  return Object.freeze({
    async admit(request: RecordingRequest, selection: RecordingSelection, supplied: unknown): Promise<ReceiptView> {
      const value = validate.admission(supplied);
      const result = await authority(request, selection, false, async (tx, actor, student, fresh, conflict, limit) => {
        const expected = binding(actor, student); await data.mutex(tx, actor.tenantId, fresh);
        const candidate = await data.request(tx, actor, value.requestId); fresh();
        if (candidate) {
          const collision = await data.existingLedger(tx, candidate); fresh(); if (collision) throw conflict;
          const previous = await data.lock(tx, actor.tenantId, candidate.id, actor.studentId); fresh(); if (!previous) throw conflict;
          if (!matches(previous, expected, generation) || previous.declaredBytes !== value.declaredBytes) throw conflict;
          const slots = await data.slots(tx, previous); fresh(); return view(previous, slots);
        }
        const instant = await data.clock(tx); fresh(); const totals = await data.aggregates(tx, actor, instant, fresh);
        if (!withinLimits(totals, value.declaredBytes)) throw limit;
        const identities = data.identities(); if (await data.collision(tx, identities.originalRecordingId, identities.assetId)) throw conflict; fresh();
        const row = await data.insert(tx, { ...identities, tenantId: actor.tenantId, studentId: actor.studentId, requestId: value.requestId,
          storeGeneration: generation, ...expected, declaredBytes: value.declaredBytes, slotCount: Math.ceil(value.declaredBytes / 1048576), state: "receiving", revision: 1n, retentionCeremonyDate: student.ceremonyDate }); fresh();
        const slots = await data.insertSlots(tx, row); fresh(); return view(row, slots);
      });
      return result.value;
    },
    async prepareSlot(request: RecordingRequest, selection: RecordingSelection, supplied: unknown): Promise<ReceiptView> {
      const value = validate.slot(supplied, true);
      if (!("bodySha256" in value)) throw new AccessUnavailable();
      const result = await authority(request, selection, false, async (tx, actor, student, fresh, conflict) => {
        const { row, slots } = await locked(tx, actor, student, value.receiptId, fresh, conflict), slot = slots[value.slotIndex];
        if (row.state !== "receiving" || row.revision !== value.expectedRevision || !slot || slot.revision !== value.expectedSlotRevision) throw conflict;
        if (slot.state === "prepared" && slot.bodySha256 === value.bodySha256 && slot.permitEtag === value.permitEtag) return view(row, slots);
        if (slot.state !== "reserved") throw conflict;
        const changed = await data.prepare(tx, slot, value.bodySha256, value.permitEtag); fresh(); if (!changed) throw conflict;
        return view(row, slots.map(s => s.slotIndex === changed.slotIndex ? changed : s));
      }); return result.value;
    },
    async openSlot(request: RecordingRequest, selection: RecordingSelection, supplied: unknown): Promise<CommittedReceiptOpening> {
      const value = validate.slot(supplied);
      const result = await authority(request, selection, false, async (tx, actor, student, fresh, conflict) => {
        const { row, slots } = await locked(tx, actor, student, value.receiptId, fresh, conflict), slot = slots[value.slotIndex];
        if (row.state !== "receiving" || row.revision !== value.expectedRevision || !slot || slot.revision !== value.expectedSlotRevision || slot.state !== "prepared" || slot.everUploadOpened) throw conflict;
        const opened = await data.open(tx, slot); fresh(); if (!opened || !opened.bodySha256 || !opened.permitEtag || !opened.openOperationId) throw conflict;
        return Object.freeze({ receiptId: row.id, originalRecordingId: row.originalRecordingId, assetId: row.assetId, slotIndex: opened.slotIndex,
          objectKey: opened.objectKey, expectedBytes: opened.expectedBytes, bodySha256: opened.bodySha256, permitEtag: opened.permitEtag, operationId: opened.openOperationId });
      });
      const opening = Object.freeze({}) as CommittedReceiptOpening; permissions.set(opening, { fresh: result.fresh, value: result.value }); return opening;
    },
    consumeOpening(opening: unknown) {
      if (!opening || typeof opening !== "object") throw new AccessUnavailable();
      const value = permissions.get(opening); if (!value) throw new AccessUnavailable(); permissions.delete(opening);
      try { value.fresh(); return value.value; } catch (error) { if (error instanceof AccessDenied) throw error; throw new AccessUnavailable(); }
    },
    async retire(request: RecordingRequest, selection: RecordingSelection, supplied: unknown): Promise<ReceiptView> {
      const value = validate.target(supplied);
      const result = await authority(request, selection, true, async (tx, actor, student, fresh, conflict) => {
        const { row, slots } = await locked(tx, actor, student, value.receiptId, fresh, conflict);
        if (row.revision !== value.expectedRevision) throw conflict;
        if (row.state !== "receiving") return view(row, slots);
        const changed = await data.retire(tx, row, fresh().due); fresh(); if (!changed) throw conflict;
        const retired = await data.retireSlots(tx, row); fresh(); return view(changed, retired);
      }); return result.value;
    },
  });
}

export type ReceiptTestMaintenanceScope = Readonly<{ receipt: ReceiptView; closeNeverOpened: (expectedRevision: bigint) => Promise<ReceiptView> }>;
/** TEST-ONLY trusted adapter seam. No production adapter/login/scope is supplied.
 * No transaction/SQL handle escapes; each transaction binds exactly ONE head. */
export function createRecordingReceiptTestMaintenance<Q extends PgQueryResultHKT>(input: { transaction: <T>(action: (tx: AccessTransaction<Q>) => Promise<T>) => Promise<T> }) {
  return Object.freeze({ async withHead<T>(supplied: unknown, action: (scope: ReceiptTestMaintenanceScope) => Promise<T>): Promise<T> {
    const target = validate.maintenanceTarget(supplied);
    try { return await input.transaction(async tx => {
      let active = true, used = false, pending = false, poisoned = false, failure: unknown, tracked: Promise<ReceiptView> | undefined;
      const poison = (error: unknown) => { if (!poisoned) { poisoned = true; failure = error; } };
      const fresh = () => { if (!active || poisoned) throw new AccessUnavailable(); };
      await data.mutex(tx, target.tenantId, fresh);
      const hint = await data.hint(tx, target.tenantId, target.receiptId); fresh(); if (!hint) throw new AccessDenied(404);
      await data.existingLedger(tx, hint); fresh();
      const row = await data.lock(tx, target.tenantId, target.receiptId); fresh(); if (!row) throw new AccessDenied(404);
      const slots = await data.slots(tx, row); fresh();
      const closeNeverOpened = (expected: bigint) => {
        if (!active || used) { const error = new AccessUnavailable(); poison(error); const rejected = Promise.reject(error); void rejected.catch(() => {}); return rejected; }
        used = true; pending = true;
        tracked = (async () => { try {
          fresh(); const revision = validate.revision(expected);
          if (row.revision !== revision || row.state !== "retiring" || slots.length !== row.slotCount || slots.some(s => s.state !== "retiring" || s.everUploadOpened || s.openOperationId !== null || s.openedAt !== null)) throw new RecordingReceiptConflict();
          const terminal = await data.terminal(tx, row); fresh(); if (!terminal) throw new RecordingReceiptConflict();
          const closed = await data.closeSlots(tx, row); fresh(); if (closed.length !== slots.length) throw new RecordingReceiptConflict();
          return view(terminal, closed);
        } catch (error) { poison(error); throw error; } })();
        void tracked.then(() => { pending = false; }, () => { pending = false; }); return tracked;
      };
      let result!: T;
      try { result = await action(Object.freeze({ receipt: view(row, slots), closeNeverOpened })); }
      catch (error) { poison(error); }
      finally { active = false; if (!used || pending) poison(new AccessUnavailable()); if (tracked) { try { await tracked; } catch { /* observed; rollback below */ } } }
      if (poisoned) throw failure; return result;
    }); } catch (error) { if (error instanceof RecordingReceiptConflict || error instanceof AccessDenied) throw error; throw new AccessUnavailable(); }
  } });
}
