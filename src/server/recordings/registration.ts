import "server-only";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { RecordingConflict, RecordingReceipt, RecordingSelection } from "../../lib/recordings/types";
import { createRecordingAuthority, type RecordingDependencies, type RecordingRequest } from "./authority";
import { receipt } from "./service";
import * as data from "../data/recordings";
import * as validate from "./validation";
import type { VerifiedRecordingDescriptor } from "./validation";

/** Internal seam only. Callers must independently verify bytes and ownership.
 * This module is deliberately absent from runtime composition and HTTP. */
export function createStudentRecordingRegistrar<Q extends PgQueryResultHKT>(input: RecordingDependencies<Q>) {
  const authorized = createRecordingAuthority(input);
  return Object.freeze({
    async register(request: RecordingRequest, selection: RecordingSelection, supplied: VerifiedRecordingDescriptor): Promise<RecordingReceipt | RecordingConflict> {
      const descriptor = validate.descriptor(supplied);
      return authorized(request, selection, true, false, async (tx, actor, _student, fresh) => {
        const instant = new Date(fresh().instant);
        let row = await data.insert(tx, actor, descriptor, instant); fresh();
        if (!row) {
          row = await data.asset(tx, actor, descriptor.assetId); fresh();
          if (!row || row.state === "deleting" || row.contentSha256 !== descriptor.contentSha256 || row.mediaType !== descriptor.media.mediaType || row.byteLength !== descriptor.media.byteLength || row.durationMs !== descriptor.media.durationMs) return { ok: false, code: "conflict" };
        } else { await data.audit(tx, actor, "create", row.id); fresh(); }
        return receipt(row);
      });
    },
  });
}
