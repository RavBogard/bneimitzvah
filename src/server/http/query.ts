import "server-only";
import { HttpBoundaryError } from "./responses";

export function closedObject(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.getOwnPropertySymbols(value).length) throw 0;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Object.keys(descriptors).length > 64 || Object.keys(descriptors).some((key) => ![...required, ...optional].includes(key) || !Object.hasOwn(descriptors[key], "value"))
      || required.some((key) => !Object.hasOwn(descriptors, key))) throw 0;
    const result = Object.create(null) as Record<string, unknown>;
    for (const [key, descriptor] of Object.entries(descriptors)) result[key] = descriptor.value;
    return result;
  } catch { throw new HttpBoundaryError(); }
}
const forbiddenKeys = new Set(["handle", "context", "practicecontext", "xpracticecontext", "sessiontoken", "accesstoken", "authorization", "cookie"]);
export function uniqueQuery(input: string, allowed: readonly string[]): URLSearchParams {
  try {
    if (typeof input !== "string" || input.length > 2048 || /[\s\\\x00-\x1f\x7f]/.test(input) || /%(?![a-fA-F0-9]{2})/.test(input)) throw 0;
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw 0;
    const seen = new Set<string>();
    for (const [key, value] of url.searchParams) {
      if (!allowed.includes(key) || forbiddenKeys.has(key.toLowerCase().replace(/[-_]/g, "")) || seen.has(key) || key.length > 64 || value.length > 1024
        || /[\u0000-\u001f\u007f\ufffd]/.test(key + value)) throw 0;
      seen.add(key);
    }
    return url.searchParams;
  } catch { throw new HttpBoundaryError(); }
}
