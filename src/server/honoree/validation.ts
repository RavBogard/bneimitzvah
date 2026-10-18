import "server-only";
import { createHash } from "node:crypto";
import { closedObject } from "../http/query";
import { uuid, integer } from "../student-work/validation";
import { selection } from "../honors/validation";
import { HttpBoundaryError } from "../http/responses";
export { selection };
export const LIMITS = Object.freeze({ requestBytes: 1024, materialBytes: 65536, responseBytes: 98304 });
const invalid = (): never => { throw new HttpBoundaryError(); };
export const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function start(value: unknown): string { if (typeof value !== "string" || value.length > 80 || !/^[A-Za-z0-9 ]+ [1-9][0-9]*:[1-9][0-9]*$/.test(value)) return invalid(); return value; }
export type HonoreeIntent = Readonly<{ operation: "issue" | "revoke" | "reissue"; mutationId: string; expectedVersion: number; contextHash: string; startVerse: string; linkId: string | null }>;
export function intent(input: unknown): HonoreeIntent {
  const v = closedObject(input, ["operation", "mutationId", "expectedVersion", "contextHash", "startVerse", "linkId"]);
  if (!["issue", "revoke", "reissue"].includes(v.operation as string) || typeof v.contextHash !== "string" || !/^[a-f0-9]{64}$/.test(v.contextHash)) return invalid();
  if (v.operation === "issue" ? v.linkId !== null : typeof v.linkId !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(v.linkId)) return invalid();
  return Object.freeze({ operation: v.operation as HonoreeIntent["operation"], mutationId: uuid(v.mutationId), expectedVersion: integer(v.expectedVersion, 1, 2147483647), contextHash: v.contextHash, startVerse: start(v.startVerse), linkId: v.linkId as string | null });
}
export function bounded<T>(value: T, bytes: number = LIMITS.responseBytes): T { if (Buffer.byteLength(JSON.stringify(value)) > bytes) return invalid(); return value; }
