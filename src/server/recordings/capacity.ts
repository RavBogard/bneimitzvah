import "server-only";

/** Primary retained liabilities only. Receipt pipeline/rate facts are separate. */
export type RecordingCapacity = Readonly<{
  studentBytes: bigint; tenantBytes: bigint; studentTakes: bigint; tenantTakes: bigint;
  studentIds: bigint; tenantIds: bigint;
}>;
export const RECORDING_CAPACITY = Object.freeze({ studentBytes: 10n * 1024n ** 3n, tenantBytes: 256n * 1024n ** 3n,
  studentTakes: 1000n, tenantTakes: 20000n, studentIds: 4096n, tenantIds: 65536n });

/** Call under the tenant admission mutex, only for a genuinely new identity. */
export function withinRecordingCapacity(m: RecordingCapacity, bytes: number) {
  return m.studentBytes + BigInt(bytes) <= RECORDING_CAPACITY.studentBytes
    && m.tenantBytes + BigInt(bytes) <= RECORDING_CAPACITY.tenantBytes
    && m.studentTakes + 1n <= RECORDING_CAPACITY.studentTakes && m.tenantTakes + 1n <= RECORDING_CAPACITY.tenantTakes
    && m.studentIds + 1n <= RECORDING_CAPACITY.studentIds && m.tenantIds + 1n <= RECORDING_CAPACITY.tenantIds;
}
