import "server-only";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import type { HebrewSegment, HebrewVerse } from "./types";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
const invalid = () => { throw new Error("Unsupported study markup"); };
function plain(value: string, hebrew: boolean) {
  // Preserve CGJ and Hebrew marks; reject invalid UTF-16 and direction overrides.
  if (!value.isWellFormed() || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069\uFEFF]/u.test(value)) invalid();
  const normalized = value.normalize("NFC").replace(/[\u00A0\u2009\t\r ]+/g, " ");
  return hebrew ? normalized.replace(/\n/g, " ").replace(/ +/g, " ") : normalized.replace(/ *\n */g, "\n");
}
function tree(input: unknown) {
  if (typeof input !== "string" || Buffer.byteLength(input) > 64 * 1024 || !input.isWellFormed()
    || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069\uFEFF]/u.test(input)) invalid();
  let error = false;
  const result = parseFragment(input as string, { scriptingEnabled: false, onParseError: () => { error = true; } });
  let nodes = 0;
  const check = (node: Node, depth: number) => {
    if (++nodes > 4096 || depth > 32) invalid();
    if ("childNodes" in node) for (const child of node.childNodes) check(child, depth + 1);
  };
  check(result, 0);
  if (error) invalid();
  return result.childNodes;
}
function element(node: Node): Element {
  if (!("tagName" in node) || node.namespaceURI !== "http://www.w3.org/1999/xhtml") return invalid();
  if (node.attrs.some(attr => attr.name !== "class" || attr.namespace)) invalid();
  return node;
}
const classes = (node: Element) => (node.attrs.find(attr => attr.name === "class")?.value ?? "").trim().split(/\s+/).filter(Boolean);
const note = (node: Element) => (node.tagName === "sup" && classes(node).join() === "footnote-marker")
  || (node.tagName === "i" && classes(node).join() === "footnote");
function basic(node: Node, hebrew: boolean): string {
  if (node.nodeName === "#text") return plain((node as DefaultTreeAdapterMap["textNode"]).value, hebrew);
  const el = element(node);
  if (note(el)) return ""; // Entire subtree omitted; never render or follow links.
  const cls = classes(el);
  if (!["b", "i", "small", "big", "span", "br"].includes(el.tagName)
    || cls.some(c => hebrew || !["poetry", "indentAll"].includes(c))) invalid();
  if (el.tagName === "br") return hebrew ? " " : "\n";
  return el.childNodes.map(child => basic(child, hebrew)).join("");
}
export function normalizeEnglish(input: unknown): string | null {
  const text = plain(tree(input).map(node => basic(node, false)).join(""), false).trim();
  return text || null;
}
export function normalizeHebrew(input: unknown): HebrewVerse {
  const segments: HebrewSegment[] = [];
  const addText = (text: string) => { if (text) segments.push(Object.freeze({ kind: "text", text })); };
  const walk = (node: Node) => {
    if (node.nodeName === "#text") { addText(plain((node as DefaultTreeAdapterMap["textNode"]).value, true)); return; }
    const el = element(node), cls = classes(el);
    if (note(el)) return;
    if (el.tagName === "span" && cls.length === 1) {
      const semantic = cls[0];
      if (semantic === "mam-kq-trivial") {
        // Reviewed MAM shape: one plain text form, not a two-sided alternative.
        // Do not strip unknown/nested semantics or manufacture a second reading.
        if (el.childNodes.length !== 1 || el.childNodes[0].nodeName !== "#text") invalid();
        const text = plain((el.childNodes[0] as DefaultTreeAdapterMap["textNode"]).value, true);
        if (!/[א-ת]/u.test(text) || /[\[\]]/.test(text)) invalid();
        addText(text); return;
      }
      if (semantic === "mam-kq") {
        const children = el.childNodes.filter(child => !(child.nodeName === "#text" && /^\s*$/.test((child as DefaultTreeAdapterMap["textNode"]).value)));
        if (children.length !== 2) invalid();
        const sides = children.map(element);
        const written = sides.find(side => side.tagName === "span" && classes(side).join() === "mam-kq-k");
        const read = sides.find(side => side.tagName === "span" && classes(side).join() === "mam-kq-q");
        if (!written || !read) return invalid();
        const text = (n: Element) => plain(n.childNodes.map(child => basic(child, true)).join(""), true).trim();
        const k = text(written), rawQ = text(read), q = rawQ.startsWith("[") && rawQ.endsWith("]") ? rawQ.slice(1, -1).trim() : rawQ;
        if (!k || !q || /[\[\]]/.test(k + q) || !/[א-ת]/u.test(k) || !/[א-ת]/u.test(q)) invalid();
        segments.push(Object.freeze({ kind: "alternative", written: k, read: q })); return;
      }
      if (semantic === "mam-spi-pe" || semantic === "mam-spi-samekh") {
        const marker = el.childNodes.map(child => basic(child, true)).join("").trim();
        if (marker !== (semantic === "mam-spi-pe" ? "{פ}" : "{ס}")) invalid();
        segments.push(Object.freeze({ kind: "gap", break: semantic === "mam-spi-pe" ? "petuchah" : "setumah" })); return;
      }
      if (semantic === "mam-spi-invnun") {
        // It is a Masoretic sign, never an additional spoken letter.
        const marker = el.childNodes.map(child => basic(child, true)).join("").trim();
        if (marker !== "׆") invalid();
        segments.push(Object.freeze({ kind: "inverted-nun" })); return;
      }
      invalid(); // Unknown MAM semantics require review, never silent stripping.
    }
    if (cls.length || !["b", "small", "big", "span", "br"].includes(el.tagName)) invalid();
    if (el.tagName === "br") addText(" "); else el.childNodes.forEach(walk);
  };
  tree(input).forEach(walk);
  let paragraphAfter: HebrewVerse["paragraphAfter"] = null;
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    if (segment.kind === "text" && !segment.text.trim() || segment.kind === "inverted-nun") continue;
    if (segment.kind === "gap") paragraphAfter = segment.break;
    break;
  }
  const combine = (reading: boolean) => plain(segments.map(segment => segment.kind === "text" ? segment.text
    : segment.kind === "alternative" ? (reading ? segment.read : segment.written) : segment.kind === "gap" ? " " : "").join(""), true).trim();
  const text = combine(false), readingText = combine(true);
  if (!/[א-ת]/u.test(text) || !/[א-ת]/u.test(readingText)) invalid();
  return Object.freeze({ text, readingText, segments: Object.freeze(segments), paragraphAfter });
}
