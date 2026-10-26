import { useId, type ReactNode } from "react";
import type { ServiceBlock, ServiceSpan, ServiceUnitMaterial } from "../../../lib/service-learning/types";
import hebrewStyles from "../../../styles/hebrew-font.module.css";
import { unitLayout, unitSegments, type TextSegment } from "./unit-layout";

type Note = { number: number; body: ReactNode };

/** Pure presentation of exactly one already-authorized, projected source unit. */
export function ServiceUnitView({ material }: { material: ServiceUnitMaterial }) {
  const id = useId(), unit = material.unit, layout = unitLayout(unit), segments = unitSegments(unit);
  const notes: Note[] = [];
  function note(body: readonly ServiceSpan[]): ReactNode {
    const number = notes.length + 1, entry: Note = { number, body: null };
    notes.push(entry);
    entry.body = spans(body);
    return <sup className="service-note-reference"><a href={`#${id}-note-${number}`} aria-label={`Read note ${number}`}>Note {number}</a></sup>;
  }
  function spans(value: string | readonly ServiceSpan[]): ReactNode {
    if (typeof value === "string") return value;
    return value.map((span, index) => <span key={index}>{"t" in span ? span.t : "em" in span ? <em>{spans(span.em)}</em> : "strong" in span ? <strong>{spans(span.strong)}</strong> : note(span.footnote)}</span>);
  }
  function english(value: ServiceBlock["en"], index: number): ReactNode {
    if (value === undefined) return null;
    if (typeof value !== "string") return spans(value);
    const pointers = unit.sourceBoundaries?.en.filter(pointer => pointer.block === index) ?? [];
    const parts: string[] = []; let from = 0;
    for (const pointer of pointers) {
      const found = value.indexOf(pointer.endAfter), end = found + pointer.endAfter.length;
      if (found < 0 || found !== value.lastIndexOf(pointer.endAfter) || end <= from || end >= value.length) return value;
      parts.push(value.slice(from, end)); from = end;
    }
    parts.push(value.slice(from));
    return parts.map((part, partIndex) => <span className="service-source-segment" key={partIndex}>{part}</span>);
  }
  function hebrew(text: string): ReactNode {
    return <p className={`service-unit-hebrew study-hebrew ${hebrewStyles.reading}`} lang="he" dir="rtl">{text}</p>;
  }
  function texts(block: ServiceBlock, index: number, pieces?: readonly TextSegment[]): ReactNode {
    const sourceEnglish = block.role === "original" || block.type === "rubric";
    const englishClass = sourceEnglish ? "service-source-english" : "service-unit-english";
    if (pieces) return pieces.map((piece, segmentIndex) => <div className="service-reading-segment" key={segmentIndex}>
      {block.he !== undefined && hebrew(piece.he)}
      {block.en !== undefined && <div className={englishClass} lang="en" dir="ltr">{piece.en}</div>}
    </div>);
    return <>{block.he !== undefined && hebrew(block.he)}
      {block.en !== undefined && <div className={englishClass} lang="en" dir="ltr">{english(block.en, index)}</div>}
    </>;
  }
  function block(index: number): ReactNode {
    const source = unit.blocks[index];
    return <div className={`service-source-block service-source-${source.type}${source.gold ? " service-source-emphasis" : ""}`} key={index}>
      {source.marks?.map((mark, markIndex) => <p className="service-source-mark field-help" key={markIndex}>{mark.label}</p>)}
      {source.cue !== undefined && <p className="service-source-cue field-help">{source.cue}</p>}
      {source.occasion !== undefined && <p className="service-source-occasion field-help">{source.occasion}</p>}
      {(source.label !== undefined || source.verse !== undefined) && <p className="service-source-label">{source.label ?? source.verse}</p>}
      {source.text !== undefined && <div className="service-source-instruction" lang="en" dir="ltr">{spans(source.text)}</div>}
      {texts(source, index, segments?.get(index))}
      {source.footnote !== undefined && <div className="service-source-note-reference">{note(source.footnote)}</div>}
    </div>;
  }
  // Build once so both inline and block notes enter a single apparatus in order.
  const body = layout.groups.map((group, index) => <div className={`service-unit-group${group.refrain ? " service-unit-refrain" : ""}`} key={index}>{group.indices.map(block)}</div>);
  return <article className="service-unit" aria-labelledby={`${id}-title`} data-layout={layout.kind} data-granularity={material.blockGranularity}>
    <header><h3 id={`${id}-title`}><bdi dir="auto">{unit.name}</bdi></h3>
      {unit.caption !== undefined && <p className="service-unit-caption field-help">{unit.caption}</p>}
    </header>
    <div className="service-unit-body">{body}</div>
    {notes.length > 0 && <section className="service-unit-notes" aria-label="Source notes">
      {notes.map(entry => <details key={entry.number}><summary id={`${id}-note-${entry.number}`}>Note {entry.number}</summary><div lang="en" dir="ltr">{entry.body}</div></details>)}
    </section>}
    <footer className="service-unit-credits field-help">
      {material.license.attribution !== undefined && <p>{material.license.attribution}</p>}
      <p>{material.license.spdx}</p>
    </footer>
  </article>;
}
