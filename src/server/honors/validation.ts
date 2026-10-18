import "server-only";
import { createHash } from "node:crypto";
import { closedObject } from "../http/query";
import { HttpBoundaryError } from "../http/responses";
import { uuid, integer, verse } from "../student-work/validation";
import type { AliyahPerson, GenerationPerson, HonorPerson, HonorsForm, HonorsIntent, HonorsSelection } from "../../lib/honors/types";
export const LIMITS = Object.freeze({ people: 256, list: 32, aliyot: 1000, payloadBytes: 65536, contextBytes: 262144, responseBytes: 1280 * 1024 });
const invalid = (): never => { throw new HttpBoundaryError(); };
export function name(value: unknown, cap = 256): string {
  if (typeof value !== "string" || !value.isWellFormed()) return invalid();
  // Check before trimming: controls/format overrides cannot hide at an edge.
  if (/[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff<>]/u.test(value)) return invalid();
  const result = value.normalize("NFC").trim();
  if (!result || Buffer.byteLength(result, "utf8") > cap) return invalid(); return result;
}
export function dense(value: unknown, max: number): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) return invalid();
  const copy: unknown[] = [];
  for (let i = 0; i < value.length; i++) { const d = Object.getOwnPropertyDescriptor(value, String(i)); if (!d || !Object.hasOwn(d, "value")) return invalid(); copy.push(d.value); }
  return copy;
}
export function form(input: unknown): HonorsForm {
  const value = closedObject(input, ["schemaVersion", "openingArk", "generationToGeneration", "undressingTorah", "redressingTorah", "closingArk", "aliyot", "parentalBlessing"]);
  if (value.schemaVersion !== 1) return invalid();
  const ids = new Set<string>(); let people = 0;
  const optional = (v: unknown, cap = 256) => v === null ? null : name(v, cap);
  const person = (v: unknown, kind: "ordinary" | "generation" | "aliyah"): HonorPerson | GenerationPerson | AliyahPerson => {
    const row = closedObject(v, ["id", "englishName", ...(kind !== "ordinary" ? ["relationship"] : []), ...(kind === "aliyah" ? ["hebrewName", "parent1HebrewName", "parent2HebrewName"] : [])]);
    const id = uuid(row.id); if (ids.has(id) || ++people > LIMITS.people) return invalid(); ids.add(id);
    return Object.freeze({ id, englishName: name(row.englishName), ...(kind !== "ordinary" ? { relationship: optional(row.relationship, 160) } : {}),
      ...(kind === "aliyah" ? { hebrewName: optional(row.hebrewName), parent1HebrewName: optional(row.parent1HebrewName), parent2HebrewName: optional(row.parent2HebrewName) } : {}) });
  };
  const ordinary = (v: unknown) => Object.freeze(dense(v, LIMITS.list).map(p => person(p, "ordinary") as HonorPerson));
  const openingArk = ordinary(value.openingArk), generationToGeneration = Object.freeze(dense(value.generationToGeneration, LIMITS.list).map(p => person(p, "generation") as GenerationPerson)),
    undressingTorah = ordinary(value.undressingTorah), redressingTorah = ordinary(value.redressingTorah), closingArk = ordinary(value.closingArk);
  const starts = new Set<string>();
  const aliyot = Object.freeze(dense(value.aliyot, LIMITS.aliyot).map(v => { const row = closedObject(v, ["startVerse", "participants"]), startVerse = verse(row.startVerse);
    if (starts.has(startVerse)) return invalid(); starts.add(startVerse);
    return Object.freeze({ startVerse, participants: Object.freeze(dense(row.participants, LIMITS.list).map(p => person(p, "aliyah") as AliyahPerson)) }); }));
  const blessing = closedObject(value.parentalBlessing, ["participation", "delivery"]);
  if (![null, "yes", "no"].includes(blessing.participation as null) || ![null, "together", "separately"].includes(blessing.delivery as null) || blessing.delivery !== null && blessing.participation !== "yes") return invalid();
  const result: HonorsForm = Object.freeze({ schemaVersion: 1, openingArk, generationToGeneration, undressingTorah, redressingTorah, closingArk, aliyot,
    parentalBlessing: Object.freeze({ participation: blessing.participation as HonorsForm["parentalBlessing"]["participation"], delivery: blessing.delivery as HonorsForm["parentalBlessing"]["delivery"] }) });
  if (Buffer.byteLength(JSON.stringify(result)) > LIMITS.payloadBytes) return invalid(); return result;
}
export function hash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function selection(input: unknown): HonorsSelection { const row = closedObject(input, ["mode", "studentId"]);
  if (!["admin", "parent", "tutor", "student"].includes(row.mode as string)) return invalid(); return Object.freeze({ mode: row.mode as HonorsSelection["mode"], studentId: uuid(row.studentId) }); }
export function intent(input: unknown): HonorsIntent { const row = closedObject(input, ["expectedVersion", "mutationId", "contextHash", "form"]);
  if (typeof row.contextHash !== "string" || !/^[a-f0-9]{64}$/.test(row.contextHash)) return invalid();
  return Object.freeze({ expectedVersion: integer(row.expectedVersion, 0), mutationId: uuid(row.mutationId), contextHash: row.contextHash, form: form(row.form) }); }
export function digest(selected: HonorsSelection, write: HonorsIntent) { return hash(["honors:v1", selected.studentId, selected.mode, write.expectedVersion, write.contextHash, write.form]); }
