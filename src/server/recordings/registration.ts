import "server-only";
import { randomUUID } from "node:crypto";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { RecordingConflict, RecordingReceipt, RecordingSelection } from "../../lib/recordings/types";
import { createRecordingAuthority, type RecordingDependencies, type RecordingRequest, type RecordingFreshness } from "./authority";
import { AccessDenied } from "../access/errors";
import type { AccessTransaction } from "../access/types";
import type { StudentView } from "../data/students";
import { receipt } from "./service";
import * as data from "../data/recordings";
import * as admission from "../data/recording-receipts";
import { withinRecordingCapacity } from "./capacity";
import * as validate from "./validation";
import type { VerifiedRecordingDescriptor } from "./validation";

/** Server-internal result only. No route/runtime registration is exposed. */
export class RecordingRegistrationConflict extends Error {
  readonly code = "conflict";
  constructor() { super("Recording registration conflict"); this.name = "RecordingRegistrationConflict"; }
}
export class RecordingRegistrationLimit extends Error {
  readonly code = "limit";
  constructor() { super("Recording registration limit reached"); this.name = "RecordingRegistrationLimit"; }
}
export type RecordingRegistrationScope<Q extends PgQueryResultHKT> = Readonly<{
  tx: AccessTransaction<Q>; actor: data.RecordingActor; student: StudentView; fresh: RecordingFreshness;
  registerVerified: (originalRecordingId: string, descriptor: VerifiedRecordingDescriptor) => Promise<RecordingReceipt>;
}>;
const unavailable = () => new Error("Recording registration scope unavailable");

function matches(row: data.RecordingRow, descriptor: VerifiedRecordingDescriptor) {
  return (row.state === "private" || row.state === "submitted") && row.assetId === descriptor.assetId
    && row.contentSha256 === descriptor.contentSha256 && row.mediaType === descriptor.media.mediaType
    && row.byteLength === descriptor.media.byteLength && row.durationMs === descriptor.media.durationMs;
}

/** Internal seam only. Callers must independently verify bytes and ownership.
 * This module is deliberately absent from runtime composition and HTTP. */
export function createStudentRecordingRegistrar<Q extends PgQueryResultHKT>(input: RecordingDependencies<Q>) {
  const authorized = createRecordingAuthority(input);
  async function registerCore(tx: AccessTransaction<Q>, actor: data.RecordingActor, fresh: RecordingFreshness,
    descriptor: VerifiedRecordingDescriptor, conflict: AccessDenied, limit: AccessDenied, originalId?: string): Promise<RecordingReceipt> {
    fresh(); const previous = await data.registrationRow(tx, actor, descriptor.assetId, originalId); fresh();
    // The asset retry uses the existing actual ID. A new implicit identity is
    // chosen exactly once under admission, never regenerated after a collision.
    const id = originalId ?? previous?.id ?? randomUUID();
    const reserved = await admission.reserved(tx, actor.tenantId, id, descriptor.assetId); fresh();
    if (reserved) throw conflict;
    if (previous) {
      if (previous.id !== id || !matches(previous, descriptor)) throw conflict;
      return receipt(previous);
    }
    const clock = await admission.clock(tx); fresh();
    const totals = await admission.aggregates(tx, actor, clock, fresh); fresh();
    if (!withinRecordingCapacity(totals, descriptor.media.byteLength)) throw limit;
    const row = await data.insertWithId(tx, actor, id, descriptor, new Date(fresh().instant)); fresh();
    // A raw SQL/global-ID race is a refusal, not a replay/adoption or new ID.
    if (!row) throw conflict;
    await data.audit(tx, actor, "create", row.id); fresh(); return receipt(row);
  }
  return Object.freeze({
    async register(request: RecordingRequest, selection: RecordingSelection, supplied: VerifiedRecordingDescriptor): Promise<RecordingReceipt | RecordingConflict> {
      const descriptor = validate.descriptor(supplied);
      // Only this exact private signal crosses the existing auth sanitizer.
      const conflict = new AccessDenied(404), limit = new AccessDenied(404);
      try { return await authorized(request, selection, true, false, async (tx, actor, _student, fresh) => {
        await admission.mutex(tx, actor.tenantId, fresh); fresh();
        return registerCore(tx, actor, fresh, descriptor, conflict, limit);
      }); }
      catch (error) { if (error === conflict) return { ok: false, code: "conflict" }; if (error === limit) throw new RecordingRegistrationLimit(); throw error; }
    },
    async withRegistrationAuthority<T>(request: RecordingRequest, selection: RecordingSelection,
      action: (scope: RecordingRegistrationScope<Q>) => T | Promise<T>): Promise<T> {
      const conflict = new AccessDenied(404), limit = new AccessDenied(404);
      try {
        return await authorized(request, selection, true, false, async (tx, actor, student, fresh) => {
          await admission.mutex(tx, actor.tenantId, fresh); fresh();
          let active = true, used = false, pending = false, poisoned = false, failure: unknown, tracked: Promise<RecordingReceipt> | undefined;
          const poison = (error: unknown) => { if (!poisoned) { poisoned = true; failure = error; } };
          const checkpoint: RecordingFreshness = () => { if (!active || poisoned) throw unavailable(); return fresh(); };
          const registerVerified = (originalRecordingId: string, supplied: VerifiedRecordingDescriptor): Promise<RecordingReceipt> => {
            if (!active || used) {
              const error = unavailable(); poison(error); const rejected = Promise.reject(error); void rejected.catch(() => {}); return rejected;
            }
            used = true; pending = true;
            tracked = (async () => {
              try {
                checkpoint(); const id = validate.recordingId(originalRecordingId), descriptor = validate.descriptor(supplied); checkpoint();
                return await registerCore(tx, actor, checkpoint, descriptor, conflict, limit, id);
              } catch (error) { poison(error); throw error; }
            })();
            // Observe even a caller's unawaited rejection; the outer scope still
            // rejects and drains this operation before its transaction exits.
            void tracked.then(() => { pending = false; }, () => { pending = false; });
            return tracked;
          };
          let value!: T;
          try { value = await action(Object.freeze({ tx, actor, student, fresh: checkpoint, registerVerified })); }
          catch (error) { poisoned = true; failure = error; }
          finally {
            active = false;
            if (pending) poison(unavailable());
            if (tracked) { try { await tracked; } catch { /* Failure already poisons this scope. */ } }
          }
          if (poisoned) throw failure;
          fresh(); return value;
        });
      } catch (error) {
        if (error === conflict) throw new RecordingRegistrationConflict();
        if (error === limit) throw new RecordingRegistrationLimit();
        throw error;
      }
    },
  });
}
