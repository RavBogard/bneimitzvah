import { Fragment, type CSSProperties, type ReactNode } from "react";
import type { StudyVerse } from "../workspace/study/api";
import type { StudyChapter } from "../workspace/study/credits";
import type { AppendixGroup } from "../../../lib/print/appendix";
import type { CommentaryRun } from "../../../lib/readings/commentary";
import { SHEET_TYPE, type SheetFormat } from "../../../lib/print/sheet-format";
import { TANAKH_VERSE_COUNTS } from "../../../lib/readings/catalog";
import { DISCUSSION_LABELS } from "../../../lib/discussions/labels";
import { sheetHebrew } from "./hebrew";
import { hebrewRuns, maqafChains } from "../../../lib/hebrew/mixed-runs";
import styles from "./print.module.css";

/**
 * The reader's print sheet as a document: one table, so the running head (thead) and the edition credit (tfoot)
 * repeat on every printed page in every engine that prints tables, and each verse is one row, so its English sits
 * beside its Hebrew and a verse never splits across a page. Hebrew is on the right. Pure, so its layout is testable
 * without a browser; the page around it loads the text and owns printing.
 */
export type SheetText = Readonly<{ verses: readonly StudyVerse[]; chapters: readonly StudyChapter[] }>;
export type SheetHeading = Readonly<{ title: string; passage: string; date: string | null }>;

const VERSE = /^(.*) ([1-9]\d*):([1-9]\d*)$/;
const parts = (ref: string) => { const m = VERSE.exec(ref); return m ? { book: m[1], chapter: Number(m[2]), verse: Number(m[3]) } : null; };
const longDate = (date: string) => new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const PARAGRAPH = { petuchah: "פ", setumah: "ס" } as const;

/** What sits above a verse: a jump in the reading (its new reference) and the aliyah that begins there. */
function breaks(verses: readonly StudyVerse[], markers: ReadonlyMap<string, string>) {
  return verses.map((verse, index) => {
    const here = parts(verse.ref), before = index > 0 ? parts(verses[index - 1].ref) : null;
    const lastOfChapter = before !== null && before.verse === TANAKH_VERSE_COUNTS[before.book]?.[before.chapter - 1];
    const jump = index > 0 && here && before && !(here.book === before.book && (here.chapter === before.chapter && here.verse === before.verse + 1 || here.chapter === before.chapter + 1 && here.verse === 1 && lastOfChapter));
    const label = here && (index === 0 || jump || before && (before.book !== here.book || before.chapter !== here.chapter)) ? `${here.chapter}:${here.verse}` : here ? String(here.verse) : verse.ref;
    const n = markers.get(verse.ref);
    return { jump: jump ? verse.ref : null, aliyah: n === undefined ? null : n === "M" ? "Maftir" : `Aliyah ${n}`, label };
  });
}

/** A maqaf joins words into one chanted unit: a chain is set in a no-break span so a printed line never ends on a maqaf. */
const chained = (text: string): ReactNode => maqafChains(text).map((run, index) => run.chain ? <span key={index} className={styles.chain}>{run.text}</span> : run.text);

function Hebrew({ verse, script }: { verse: StudyVerse; script: SheetFormat["script"] }) {
  const segments = verse.hebrew.segments, last = segments.length - 1;
  return <>{segments.map((segment, index) => {
    if (segment.kind === "text") return <Fragment key={index}>{chained(sheetHebrew(segment.text, script))}</Fragment>;
    // "Letters only" is the scroll's own text: the ketiv alone, with none of the apparatus (no qere, no chip).
    if (segment.kind === "alternative" && script === "letters") return <Fragment key={index}>{chained(sheetHebrew(segment.written, script))}</Fragment>;
    // The qere is what is chanted, so it is set full size and flagged "read"; the ketiv, which the scroll writes, follows small (as on screen).
    if (segment.kind === "alternative") return <span key={index} className={styles.alternative}>
      <span>{chained(sheetHebrew(segment.read, script))}</span> <span className={styles.qere} lang="en" dir="ltr">read<span className="sr-only">. Chant this word (qere). The scroll writes it differently (ketiv).</span></span> <span className={styles.written}>{chained(sheetHebrew(segment.written, script))}</span>
    </span>;
    if (segment.kind === "gap") return index === last && verse.hebrew.paragraphAfter ? null : <span key={index} className={styles.paragraph}> {PARAGRAPH[segment.break]} </span>;
    return <span key={index} role="img" aria-label="Inverted nun, Masoretic sign">׆</span>;
  })}{verse.hebrew.paragraphAfter && <span className={styles.paragraph}> {PARAGRAPH[verse.hebrew.paragraphAfter]}</span>}</>;
}

/** The credit for every edition printed: required on every page and never optional (Daniel, 2026-10-23). */
export function sheetCredits(text: SheetText, format: SheetFormat): string[] {
  const editions = new Map(text.chapters.flatMap(chapter => chapter.editions).map(edition => [edition.key, edition]));
  const lines: string[] = [], hebrew = editions.get("mam"), english = editions.get("jps2023");
  if (format.show !== "english" && hebrew) lines.push(`Hebrew: ${hebrew.versionTitle}, ${hebrew.creator} (CC BY-SA 4.0).`);
  if (format.show !== "hebrew" && english && text.verses.some(verse => verse.english !== null)) lines.push(`English: ${english.versionTitle}, ${english.creator} (CC BY-NC 4.0).`);
  return lines;
}

/** Hebrew quoted inside English: its own language and the Hebrew face (the English face has no Hebrew glyphs, so a quoted word lost letters on paper). */
const inEnglish = (text: string): ReactNode => hebrewRuns(text).map((run, index) => run.hebrew ? <span key={index} lang="he" dir="rtl" className={styles.inlineHebrew}>{chained(run.text)}</span> : run.text);
/** Text only: bold and italic runs become <strong> and <em>; nothing is ever markup. `mixed` is for English text that quotes Hebrew. */
function Runs({ runs, mixed = false }: { runs: readonly CommentaryRun[]; mixed?: boolean }) {
  const text = (value: string) => mixed ? inEnglish(value) : chained(value);
  return <>{runs.map((run, index) => run.bold ? <strong key={index}>{text(run.text)}</strong> : run.italic ? <em key={index}>{text(run.text)}</em> : <Fragment key={index}>{text(run.text)}</Fragment>)}</>;
}

/** The commentary appendix: it starts on a new printed page, grouped by verse, each work's comments followed by its credit. */
function Appendix({ groups, heading, title }: { groups: readonly AppendixGroup[]; heading: SheetHeading; title: string }) {
  return <section className={styles.appendix} data-print-appendix aria-label={title}>
    <div className={styles.headRow}>
      <p className={styles.title}>{title}</p>
      <p className={styles.passage}><bdi>{heading.title}</bdi> <bdi dir="ltr">{heading.passage}</bdi></p>
    </div>
    {groups.map(group => <section key={group.ref} className={styles.commentGroup} data-appendix-ref={group.ref}>
      <h2 className={styles.groupRef}><bdi dir="ltr">{group.ref}</bdi></h2>
      {group.works.map(work => <div key={work.work} className={styles.workBlock} data-appendix-work={work.work}>
        <h3 className={styles.workName}><bdi>{work.label}</bdi></h3>
        {work.comments.map((comment, index) => <div key={index} className={styles.comment}>
          {comment.hebrew && <p className={styles.commentHebrew} lang="he" dir="rtl"><Runs runs={comment.hebrew} /></p>}
          {comment.english && <p className={styles.commentEnglish} lang="en" dir="ltr"><Runs runs={comment.english} mixed /></p>}
        </div>)}
        <div className={styles.commentCredit}>{work.credits.map(line => <p key={line}>{line}</p>)}</div>
      </div>)}
    </section>)}
  </section>;
}

export function PrintDocument({ heading, text, markers, format, productName, appendix = [] }: {
  heading: SheetHeading; text: SheetText; markers: ReadonlyMap<string, string>; format: SheetFormat; productName: string;
  /** The commentary appendix (appendix.ts), already licence-filtered; empty prints nothing. */
  appendix?: readonly AppendixGroup[];
}) {
  const type = SHEET_TYPE[format.size], rows = breaks(text.verses, markers), credits = sheetCredits(text, format);
  const hebrew = format.show !== "english", english = format.show !== "hebrew", notes = format.notes !== "none", numbers = format.numbers;
  const columns = (english ? 1 : 0) + (hebrew ? 1 : 0) + (numbers ? 1 : 0) + (notes ? 1 : 0);
  const style = { "--he-size": `${type.hebrew}pt`, "--en-size": `${type.english}pt` } as CSSProperties;
  const number = (label: string) => numbers ? <td className={styles.number}><bdi dir="ltr">{label}</bdi></td> : null;
  const notesCell = notes ? <td className={styles.notes} aria-hidden="true" /> : null;
  const englishCell = (verse: StudyVerse) => <td className={styles.english} lang="en" dir="ltr">{verse.english ?? <span className={styles.missing}>English reference unavailable for this verse.</span>}</td>;
  const hebrewCell = (verse: StudyVerse) => <td className={styles.hebrew} lang="he" dir="rtl"><Hebrew verse={verse} script={format.script} /></td>;
  // Column order, left to right: English, the verse number between the two languages, Hebrew, then the notes column at the
  // right edge, beside where each Hebrew verse begins. With one language the number sits where that language's lines begin.
  const verseCells = (verse: StudyVerse, label: string) => format.show === "both" ? <>{englishCell(verse)}{number(label)}{hebrewCell(verse)}{notesCell}</>
    : format.show === "hebrew" ? <>{hebrewCell(verse)}{number(label)}{notesCell}</> : <>{number(label)}{englishCell(verse)}{notesCell}</>;
  const cols = format.show === "both" ? ["english", ...(numbers ? ["number"] : []), "hebrew"] : format.show === "hebrew" ? ["hebrew", ...(numbers ? ["number"] : [])] : [...(numbers ? ["number"] : []), "english"];
  return <article className={styles.sheet} style={style} data-print-sheet-document data-show={format.show} data-script={format.script} data-size={format.size} data-spacing={format.spacing}
    data-notes={format.notes} data-numbers={numbers ? "on" : "off"} data-aliyot={format.aliyot} data-orientation={format.orientation}>
    <table className={styles.table}>
      <colgroup>{[...cols, ...(notes ? ["notes"] : [])].map(col => <col key={col} className={styles[`col-${col}`]} />)}</colgroup>
      <thead><tr><td colSpan={columns} className={styles.head}>
        <div className={styles.headRow}>
          <p className={styles.title}><bdi>{heading.title}</bdi></p>
          <p className={styles.passage}><bdi dir="ltr">{heading.passage}</bdi></p>
          {heading.date && <p className={styles.date}><time dateTime={heading.date}>{longDate(heading.date)}</time></p>}
        </div>
      </td></tr></thead>
      <tfoot><tr><td colSpan={columns} className={styles.foot}>
        <div className={styles.footRow}>
          <div className={styles.credits}>{credits.map(line => <p key={line}>{line}</p>)}</div>
          <p className={styles.product}>{productName}</p>
        </div>
      </td></tr></tfoot>
      <tbody>{text.verses.map((verse, index) => {
        const row = rows[index], first = index === 0;
        const extra: ReactNode[] = [];
        if (row.jump) extra.push(<tr key={`${verse.ref}-jump`} className={styles.jump} data-aliyah-next={row.aliyah && !first ? "" : undefined}><td colSpan={columns}><bdi dir="ltr">{row.jump}</bdi></td></tr>);
        if (row.aliyah) extra.push(<tr key={`${verse.ref}-aliyah`} className={styles.aliyah} data-aliyah-start={first ? "first" : "later"}><td colSpan={columns}><span>{row.aliyah}</span></td></tr>);
        return <Fragment key={verse.ref}>{extra}
          <tr className={styles.verse} data-verse-ref={verse.ref} data-paragraph={verse.hebrew.paragraphAfter ?? undefined}>{verseCells(verse, row.label)}</tr>
        </Fragment>;
      })}</tbody>
    </table>
    {appendix.length > 0 && <Appendix groups={appendix} heading={heading} title={format.commentary.length || !format.discussions ? "Commentary" : DISCUSSION_LABELS.list} />}
  </article>;
}
