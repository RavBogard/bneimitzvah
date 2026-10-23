import "server-only";
import { closedObject } from "../http/query";
import { HttpBoundaryError } from "../http/responses";

/**
 * Account request shapes (accounts plan section 2b). A requester's name and purpose are shown to approvers, so
 * they refuse control characters, line and paragraph separators, and bidirectional overrides and isolates
 * (U+202A-U+202E, U+2066-U+2069) that could make one name read as another. The 0037 CHECKs refuse the same set,
 * so a CHECK is never the first to fail. A purpose's line breaks become spaces: it is shown as one line.
 */
export const ACCOUNT_CONTROLS = /[\x00-\x1f\x7f-\x9f\u00ad\u061c\u115f\u1160\u200b-\u200d\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\u3164\ufeff\uffa0\u{e0000}-\u{e007f}]/u;
const invalid = (): never => { throw new HttpBoundaryError(); };

function words(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.isWellFormed()) return invalid();
  const text = value.replace(/\r\n?|\n/g, " ").trim(), length = Array.from(text).length;
  // Something readable: at least one letter, never a name made of blank-looking or invisible characters.
  if (length < 1 || length > max || ACCOUNT_CONTROLS.test(text) || !/\p{L}/u.test(text)) return invalid();
  return text;
}
export const name = (value: unknown) => {
  if (typeof value === "string" && /[\r\n]/.test(value)) return invalid();
  return words(value, 80);
};
export const purpose = (value: unknown): string | null => value === undefined || value === null || (typeof value === "string" && !value.trim()) ? null : words(value, 500);
export function uuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return invalid();
  return value.toLowerCase();
}
export type ApproverMode = "admin" | "tutor";
export const mode = (value: unknown): ApproverMode => value === "admin" || value === "tutor" ? value : invalid();

export function request(value: unknown) {
  const row = closedObject(value, ["name"], ["purpose"]);
  return Object.freeze({ name: name(row.name), purpose: purpose(row.purpose) });
}
export function decision(value: unknown) {
  const row = closedObject(value, ["mode", "requestId"]);
  return Object.freeze({ mode: mode(row.mode), requestId: uuid(row.requestId) });
}
export const endMember = (value: unknown) => Object.freeze({ memberId: uuid(closedObject(value, ["memberId"]).memberId) });
export const addApprover = (value: unknown) => Object.freeze({ tutorGrantId: uuid(closedObject(value, ["tutorGrantId"]).tutorGrantId) });
export const removeApprover = (value: unknown) => Object.freeze({ approverId: uuid(closedObject(value, ["approverId"]).approverId) });
/** A display name from an account, as staff see it: never an email address, never control or override characters. */
export function shownName(value: string | null | undefined): string {
  if (typeof value !== "string" || !value.isWellFormed() || value.includes("@")) return "Portal member";
  const text = value.replace(new RegExp(ACCOUNT_CONTROLS.source, "gu"), " ").replace(/\s+/g, " ").trim();
  return Array.from(text).slice(0, 80).join("") || "Portal member";
}
