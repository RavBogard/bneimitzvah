import type { AliyahPerson, HonorPerson, HonorsContextView, HonorsForm } from "../../../../lib/honors/types";
export const HONORS_LIMITS = Object.freeze({ people: 256, list: 32, aliyot: 1000, formBytes: 65536, contextBytes: 262144, responseBytes: 1280 * 1024 });
export const emptyHonors = (): HonorsForm => ({ schemaVersion: 1, openingArk: [], generationToGeneration: [], undressingTorah: [], redressingTorah: [], closingArk: [], aliyot: [], parentalBlessing: { participation: null, delivery: null } });
export class HonorsDraftError extends Error { constructor(message = "Check the names and try saving again.") { super(message); } }
export function own(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new HonorsDraftError();
  const descriptors = Object.getOwnPropertyDescriptors(value), names = Reflect.ownKeys(value);
  if (names.length !== keys.length || names.some(k => typeof k !== "string" || !keys.includes(k)) || keys.some(k => !descriptors[k] || !Object.hasOwn(descriptors[k], "value"))) throw new HonorsDraftError();
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}
export function dense(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) throw new HonorsDraftError();
  return Array.from({ length: value.length }, (_, i) => { const d = Object.getOwnPropertyDescriptor(value, String(i)); if (!d || !Object.hasOwn(d, "value")) throw new HonorsDraftError(); return d.value; });
}
export function uuid(value: unknown): string { if (typeof value !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) throw new HonorsDraftError(); return value.toLowerCase(); }
export const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
function label(value: unknown, max: number, nullable = false): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== "string" || !value.isWellFormed() || /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff<>]/u.test(value)) throw new HonorsDraftError("Use plain names without markup or hidden formatting.");
  const text = value.normalize("NFC").trim();
  if (!text && nullable) return null;
  if (!text || new TextEncoder().encode(text).length > max) throw new HonorsDraftError("Add an English name for each person, and keep names within the field limit."); return text;
}
/** Canonical server draft. Completely blank UI rows stay local; partial rows never disappear. */
export function captureHonorsForm(value: unknown, skipBlank = true): HonorsForm {
  const row = own(value, ["schemaVersion", "openingArk", "generationToGeneration", "undressingTorah", "redressingTorah", "closingArk", "aliyot", "parentalBlessing"]);
  if (row.schemaVersion !== 1) throw new HonorsDraftError();
  const ids = new Set<string>(); let people = 0;
  const person = (v: unknown, kind: "ordinary" | "generation" | "aliyah") => {
    const extra = kind === "aliyah" ? ["hebrewName", "parent1HebrewName", "parent2HebrewName", "relationship"] : kind === "generation" ? ["relationship"] : [];
    const p = own(v, ["id", "englishName", ...extra]);
    if (skipBlank && typeof p.englishName === "string" && !p.englishName.trim() && extra.every(k => p[k] === null || p[k] === "")) return null;
    const id = uuid(p.id); if (ids.has(id) || ++people > HONORS_LIMITS.people) throw new HonorsDraftError("Each person needs a separate entry. This form has reached its participant limit."); ids.add(id);
    const name = label(p.englishName, 256) as string;
    const relationship = kind !== "ordinary" ? label(p.relationship, 160, true) : undefined;
    return Object.freeze({ id, englishName: name, ...(kind !== "ordinary" ? { relationship } : {}), ...(kind === "aliyah" ? { hebrewName: label(p.hebrewName, 256, true), parent1HebrewName: label(p.parent1HebrewName, 256, true), parent2HebrewName: label(p.parent2HebrewName, 256, true) } : {}) });
  };
  const list = (v: unknown, kind: "ordinary" | "generation" | "aliyah") => Object.freeze(dense(v, HONORS_LIMITS.list).flatMap(p => { const value = person(p, kind); return value ? [value] : []; }));
  const starts = new Set<string>();
  const openingArk = list(row.openingArk, "ordinary"), generationToGeneration = list(row.generationToGeneration, "generation"), undressingTorah = list(row.undressingTorah, "ordinary"), redressingTorah = list(row.redressingTorah, "ordinary"), closingArk = list(row.closingArk, "ordinary");
  const aliyot = Object.freeze(dense(row.aliyot, HONORS_LIMITS.aliyot).map(v => { const a = own(v, ["startVerse", "participants"]);
    if (typeof a.startVerse !== "string" || a.startVerse.length > 100 || !/^[A-Za-z0-9 ]+ [1-9][0-9]*:[1-9][0-9]*$/.test(a.startVerse) || starts.has(a.startVerse)) throw new HonorsDraftError("Choose a different current aliyah for each group."); starts.add(a.startVerse);
    return Object.freeze({ startVerse: a.startVerse, participants: list(a.participants, "aliyah") as readonly AliyahPerson[] }); }));
  const b = own(row.parentalBlessing, ["participation", "delivery"]);
  if (![null, "yes", "no"].includes(b.participation as null) || ![null, "together", "separately"].includes(b.delivery as null) || b.delivery !== null && b.participation !== "yes") throw new HonorsDraftError("Choose whether a parental blessing is planned before choosing how it will be given.");
  const result = Object.freeze({ schemaVersion: 1, openingArk, generationToGeneration, undressingTorah, redressingTorah, closingArk, aliyot, parentalBlessing: Object.freeze({ participation: b.participation, delivery: b.delivery }) }) as HonorsForm;
  if (bytes(result) > HONORS_LIMITS.formBytes) throw new HonorsDraftError("The form is too large to save. Reduce the number or length of the entries."); return result;
}
export function formFingerprint(form: HonorsForm) { try { return JSON.stringify(captureHonorsForm(form)); } catch { return JSON.stringify(form); } }
export function sameSpans(a: HonorsContextView, b: HonorsContextView) { return JSON.stringify(a.spans) === JSON.stringify(b.spans); }
export const spanLabel = (span: { startVerse: string; endVerse: string }) => span.startVerse === span.endVerse ? span.startVerse : `${span.startVerse} – ${span.endVerse}`;
export const newPerson = (): HonorPerson => ({ id: crypto.randomUUID(), englishName: "" });
