import { Fragment, type ReactNode } from "react";

/**
 * The guide's whole markdown subset: paragraphs, "- " or "1. " lists, *emphasis* and **strong**,
 * with Hebrew runs isolated so mixed-direction sentences read correctly. It builds React nodes only:
 * no HTML, no links, no autolinking of anything (the server refuses link syntax; this never adds it).
 */
const HEBREW = /([\u0590-\u05ff\ufb1d-\ufb4f]+(?:[\s\u05be\u05f3\u05f4]+[\u0590-\u05ff\ufb1d-\ufb4f]+)*)/;

function hebrew(text: string, key: string, heClass?: string): ReactNode[] {
  return text.split(HEBREW).map((part, i) => i % 2 === 1
    ? <bdi key={`${key}-h${i}`} lang="he" dir="rtl" className={heClass}>{part}</bdi>
    : <Fragment key={`${key}-t${i}`}>{part}</Fragment>);
}
function inline(text: string, key: string, heClass?: string): ReactNode[] {
  // **strong** first, then *em* or _em_; markers without a partner stay as text.
  const out: ReactNode[] = [], pattern = /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|(?<![\p{L}\p{N}])_([^_\n]+)_(?![\p{L}\p{N}])/gu;
  let last = 0, n = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) out.push(...hebrew(text.slice(last, match.index), `${key}-${n++}`, heClass));
    if (match[1] !== undefined) out.push(<strong key={`${key}-s${n++}`}>{hebrew(match[1], `${key}-${n}`, heClass)}</strong>);
    else out.push(<em key={`${key}-e${n++}`}>{hebrew(match[2] ?? match[3] ?? "", `${key}-${n}`, heClass)}</em>);
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(...hebrew(text.slice(last), `${key}-${n++}`, heClass));
  return out;
}

export function MarkdownLite({ text, className, heClass }: { text: string; className?: string; heClass?: string }) {
  const blocks = text.replace(/\r\n?/g, "\n").split(/\n{2,}/).map(block => block.trim()).filter(Boolean);
  return <div className={className}>{blocks.map((block, b) => {
    const lines = block.split("\n").map(line => line.trim()).filter(Boolean);
    if (lines.every(line => /^[-*]\s+/.test(line))) return <ul key={b} dir="auto">{lines.map((line, i) => <li key={i}>{inline(line.replace(/^[-*]\s+/, ""), `${b}-${i}`, heClass)}</li>)}</ul>;
    if (lines.every(line => /^\d{1,3}[.)]\s+/.test(line))) return <ol key={b} dir="auto">{lines.map((line, i) => <li key={i}>{inline(line.replace(/^\d{1,3}[.)]\s+/, ""), `${b}-${i}`, heClass)}</li>)}</ol>;
    return <p key={b} dir="auto">{inline(lines.join(" "), `${b}`, heClass)}</p>;
  })}</div>;
}

/** The first sentence-ish line of a markdown text, as plain words for a compact row. */
export function firstLine(text: string, max = 160): string {
  const plain = text.replace(/\*\*|[*_]/g, "").replace(/^[-*]\s+|^\d{1,3}[.)]\s+/gm, "").split(/\n/).map(l => l.trim()).find(Boolean) ?? "";
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}
