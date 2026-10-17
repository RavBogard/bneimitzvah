import "server-only";
import { closedObject } from "../http/query";
import { HttpBoundaryError } from "../http/responses";
import { recordingId } from "./validation";
const invalid = () => { throw new HttpBoundaryError(); };
export function revision(value: unknown): bigint { return typeof value === "bigint" && value > 0n && value <= 9223372036854775807n ? value : invalid(); }
function integer(value: unknown, min: number, max: number): number { return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max ? value : invalid(); }
export function storeGeneration(value: unknown): string { return typeof value === "string" && value.length >= 1 && value.length <= 64 && !/[\u0000-\u001f\u007f]/.test(value) ? value : invalid(); }
export function admission(value: unknown) { const row = closedObject(value, ["requestId", "declaredBytes"]), bytes = integer(row.declaredBytes, 46, 28800044); if (bytes % 2) invalid(); return Object.freeze({ requestId: recordingId(row.requestId), declaredBytes: bytes }); }
export function target(value: unknown) { const row = closedObject(value, ["receiptId", "expectedRevision"]); return Object.freeze({ receiptId: recordingId(row.receiptId), expectedRevision: revision(row.expectedRevision) }); }
type SlotTarget = Readonly<{ receiptId: string; expectedRevision: bigint; slotIndex: number; expectedSlotRevision: bigint }>;
export function slot(value: unknown, preparing: true): SlotTarget & Readonly<{ bodySha256: string; permitEtag: string }>;
export function slot(value: unknown, preparing?: false): SlotTarget;
export function slot(value: unknown, preparing = false) {
  const row = closedObject(value, ["receiptId", "expectedRevision", "slotIndex", "expectedSlotRevision", ...preparing ? ["bodySha256", "permitEtag"] : []]);
  const result = { receiptId: recordingId(row.receiptId), expectedRevision: revision(row.expectedRevision), slotIndex: integer(row.slotIndex, 0, 27), expectedSlotRevision: revision(row.expectedSlotRevision) };
  if (!preparing) return Object.freeze(result);
  if (typeof row.bodySha256 !== "string" || !/^[a-f0-9]{64}$/.test(row.bodySha256) || typeof row.permitEtag !== "string" || row.permitEtag.length > 256 || !/^"[\x21\x23-\x7e]+"$/.test(row.permitEtag)) invalid();
  return Object.freeze({ ...result, bodySha256: row.bodySha256 as string, permitEtag: row.permitEtag as string });
}
export function maintenanceTarget(value: unknown) { const row = closedObject(value, ["tenantId", "receiptId"]); if (typeof row.tenantId !== "string" || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(row.tenantId)) invalid(); return { tenantId: row.tenantId as string, receiptId: recordingId(row.receiptId) }; }
