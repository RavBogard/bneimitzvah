/**
 * Credit for an edition Sefaria serves by default (Compare's translations, the Targum): what Sefaria states,
 * in plain words, never guessed. Known licence codes read as their names; "Copyright: …" is shown as Sefaria
 * gives it; nothing stated reads "licence not stated". Shared by the server projection and the browser parser.
 */
const KNOWN: Readonly<Record<string, string>> = Object.freeze({
  "Public Domain": "public domain", "PD": "public domain", "CC0": "CC0", "CC-BY": "CC BY", "CC-BY-SA": "CC BY-SA", "CC-BY-NC": "CC BY-NC",
  "CC-BY-NC-SA": "CC BY-NC-SA", "CC-BY-ND": "CC BY-ND", "CC-BY-NC-ND": "CC BY-NC-ND",
});
export const NOT_STATED = "licence not stated";
export const EDITION_TEXT_LIMITS = Object.freeze({ title: 300, license: 128 });
// Controls, bidi embedding/override/isolate controls, BOM and the tag block: never part of a credit.
const UNSAFE = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩﻿\u{e0000}-\u{e007f}<>]/gu;
/** Plain, bounded, single-line text, or null. */
export function plainCredit(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.normalize("NFC").replace(/[\t\n\r]/g, " ").replace(UNSAFE, "").replace(/\s+/g, " ").trim();
  return text && text.length <= max ? text : null;
}
/** Sefaria's licence value as readers see it. */
export function licenseLabel(raw: unknown): string {
  const text = plainCredit(raw, EDITION_TEXT_LIMITS.license);
  if (!text || text.toLowerCase() === "unknown") return NOT_STATED;
  return Object.hasOwn(KNOWN, text) ? KNOWN[text] : text;
}
/** "Title, via Sefaria (licence)". */
export const creditLine = (title: string, rawLicense: unknown) => `${title}, via Sefaria (${licenseLabel(rawLicense)})`;
