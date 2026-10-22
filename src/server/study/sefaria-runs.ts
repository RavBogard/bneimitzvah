import "server-only";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import { COMMENTARY_LIMITS, type CommentaryRun } from "../../lib/readings/commentary";

/**
 * Sefaria HTML to plain text runs, shared by every commentary. <b>/<strong>
 * become bold runs and <i>/<em> italic runs; footnotes (<sup class="footnote-marker">, <i class="footnote">
 * and any <sup>) are dropped with their content; every other tag keeps only its
 * text. Entities are decoded by the HTML parser, whitespace collapses, text is
 * NFC. The browser renders the runs as React text only, never as markup.
 */
export class SefariaMarkupRefused extends Error { constructor() { super("Sefaria markup refused"); } }
type Node = DefaultTreeAdapterMap["node"];
// Dropped with everything inside them: superscripts (footnote markers) and elements whose content is never reading text.
const DROPPED = new Set(["sup", "script", "style", "noscript", "template", "iframe", "object", "embed", "svg", "math", "select", "textarea", "title", "head"]);
const BOLD = new Set(["b", "strong"]), ITALIC = new Set(["i", "em"]);
// C0/C1 controls (newline and tab become spaces first), BOM, bidi embedding/override/isolate controls,
// interlinear annotation characters and the tag block. Direction marks (LRM/RLM) are kept: they are real in Rashi's Hebrew.
const STRIP = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069\uFEFF\uFFF9-\uFFFB\u{E0000}-\u{E007F}]/gu;

export function sefariaRuns(input: unknown, limits: Readonly<{ runChars: number; runsPerComment: number }> = COMMENTARY_LIMITS): CommentaryRun[] {
  if (typeof input !== "string" || input.length > limits.runChars) throw new SefariaMarkupRefused();
  type Style = { bold: boolean; italic: boolean };
  const raw: ({ text: string } & Style)[] = [];
  const walk = (node: Node, style: Style, depth: number) => {
    if (depth > 64) throw new SefariaMarkupRefused();
    if (node.nodeName === "#text") { raw.push({ text: (node as DefaultTreeAdapterMap["textNode"]).value, ...style }); return; }
    if (!("tagName" in node)) return; // comments
    const tag = node.tagName.toLowerCase(), classes = (node.attrs.find(attr => attr.name === "class")?.value ?? "").split(/\s+/);
    if (DROPPED.has(tag) || tag === "i" && classes.some(name => name === "footnote" || name === "footnote-marker")) return;
    if (tag === "br") { raw.push({ text: " ", ...style }); return; }
    const inner = { bold: style.bold || BOLD.has(tag), italic: style.italic || ITALIC.has(tag) };
    for (const child of node.childNodes) walk(child, inner, depth + 1);
  };
  for (const node of parseFragment(input.toWellFormed().normalize("NFC"), { scriptingEnabled: false }).childNodes) walk(node, { bold: false, italic: false }, 0);
  const runs: ({ text: string } & Style)[] = [];
  for (const part of raw) {
    let text = part.text.replace(/[\t\n\r]/g, " ").replace(STRIP, "").replace(/\s+/gu, " ");
    const last = runs.at(-1);
    if ((!last || last.text.endsWith(" ")) && text.startsWith(" ")) text = text.slice(1);
    if (!text) continue;
    if (last && last.bold === part.bold && last.italic === part.italic) last.text += text; else runs.push({ text, bold: part.bold, italic: part.italic });
  }
  while (runs.length) {
    const last = runs[runs.length - 1]; last.text = last.text.trimEnd();
    if (last.text) break; runs.pop();
  }
  if (runs.length > limits.runsPerComment) throw new SefariaMarkupRefused();
  return runs.map(run => Object.freeze({ text: run.text.normalize("NFC"), ...run.bold ? { bold: true as const } : {}, ...run.italic ? { italic: true as const } : {} }));
}
