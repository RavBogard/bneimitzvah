import "server-only";
import { closedObject } from "../http/query";
import { bounded, digest, LIMITS } from "./validation";
export type GuestBlock = Readonly<{ he: string; en: string }>;
export type GuestMaterial = Readonly<{ version: string; before: readonly GuestBlock[]; after: readonly GuestBlock[]; credits: readonly string[] }>;
export const unitPair = (slot: "morning" | "havdalah") => {
  const suffix = slot === "morning" ? "bm-shacharit" : "bm-maariv";
  return Object.freeze([`torah.blessing-before-the-torah-reading@${suffix}`, `torah.blessing-following-the-torah-reading@${suffix}`]);
};
const invalid = (): never => { throw new Error("Honoree unavailable"); };
function text(value: unknown, max: number) {
  if (typeof value !== "string" || !value.length || value.length > max || !value.isWellFormed() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return invalid(); return value;
}
/** Closed, reviewed projection only. This is not an artifact extraction/rights grant. */
export function material(input: unknown, expectedDigest?: string): GuestMaterial {
  const v = closedObject(input, ["version", "before", "after", "credits"]);
  const blocks = (value: unknown) => {
    if (!Array.isArray(value) || value.length < 1 || value.length > 64) return invalid();
    return Object.freeze(value.map(item => { const b = closedObject(item, ["he", "en"]); return Object.freeze({ he: text(b.he, 8192), en: text(b.en, 8192) }); }));
  };
  if (!Array.isArray(v.credits) || !v.credits.length || v.credits.length > 32) return invalid();
  const result = bounded(Object.freeze({ version: text(v.version, 128), before: blocks(v.before), after: blocks(v.after), credits: Object.freeze(v.credits.map(c => text(c, 4096))) }), LIMITS.materialBytes);
  if (expectedDigest !== undefined && digest(result) !== expectedDigest) return invalid(); return result;
}
