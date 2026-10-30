"use client";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PortalRequestError } from "../api";
import { call, identifier, workspaceApi, type Assigned, type ReadingMode } from "../workspace/api";
import { fetchStudyPage, type StudyKind, type StudyVerse } from "../workspace/study/api";
import type { StudyChapter } from "../workspace/study/credits";
import { fetchGuide, type GuideFetch } from "../workspace/study/guide-api";
import { guideLabelState, guideLabelText } from "../workspace/study/guide-card";
import { useIdentity } from "../../site/identity-context";
import { MarkdownLite } from "../workspace/study/markdown-lite";
import { PhraseLegend, StudyHebrew } from "../workspace/study/annotations";
import { icons } from "../workspace/study/lift";
import { serviceApi } from "../workspace/service-learning/api";
import { ServiceUnitView } from "../service-learning/unit-view";
import { parashahName } from "../workspace/today/model";
import { useProductName } from "../public-reading/product-name";
import { useDocumentTitle } from "../public-reading/view";
import { SiteBar } from "../../site/site-bar";
import { pageTitle } from "../../../lib/site/product-name";
import { colorStudyVerse } from "../../../lib/hebrew/study-annotations";
import { CRC_TENANT, teachingOf } from "../../../lib/service-course/course";
import { emphasised, typographic } from "../../../lib/service-course/copy";
import { lessonForUnit } from "../../../lib/service-course/path";
import { DEFAULT_FORMAT, type SheetFormat } from "../../../lib/print/sheet-format";
import { bookletRange, bookletSections, type BookletInput, type BookletKind, type BookletPart, type BookletReading, type BookletSection } from "../../../lib/print/booklet";
import { PrintDocument, sheetCredits } from "./document";
export { bookletHref } from "./booklet-href";
import styles from "./print.module.css";
import booklet from "./booklet.module.css";
import "../../../styles/hebrew-font.module.css";
import "../../../styles/stam-font.module.css";

/**
 * The student's study booklet (replacing the study-guide booklet, Track B): a print page the browser renders, so nothing is stored and
 * no PDF is kept. It opens through /api/students/{id}/booklet, which says which of the viewer's own modes it reads through (the learner,
 * a linked parent, a tutor under A1, an admin) or answers 404; every section then comes through the reads that mode already has.
 */
const MAX_PAGES = 10; // A reading is at most 1,000 verses, 100 to a study page.
const BOOKLET_FORMAT: SheetFormat = DEFAULT_FORMAT;
const PRACTICE_FORMAT: SheetFormat = Object.freeze({ ...DEFAULT_FORMAT, show: "hebrew", script: "letters", aliyot: "marked" });
const kindName = (kind: BookletKind) => kind === "torah" ? "Torah" : "Haftarah";
const longDate = (date: string) => new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
const displayRange = (ranges: readonly string[]) => ranges.join("; ").replace(/(\d)-(\d)/g, "$1–$2");
const statusOf = (error: unknown) => error instanceof PortalRequestError ? error.status : 503;
/** The booklet's own page title (Daniel, decided in the plan): "{Name}'s study booklet". */
export const bookletTitle = (firstName: string, lastName: string) => `${firstName} ${lastName}'s study booklet`;

type Opening = { mode: Exclude<ReadingMode, "child-practice">; tutor: string | null };
async function openBooklet(studentId: string, signal: AbortSignal): Promise<Opening> {
  const value = await call(`/api/students/${identifier(studentId)}/booklet`, undefined, undefined, signal, 4 * 1024);
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  if (Object.keys(row).length !== 3 || row.ok !== true || !["student", "parent", "tutor", "admin"].includes(String(row.mode))
    || !(row.tutor === null || typeof row.tutor === "string" && row.tutor.length <= 160 && !/[<>@\x00-\x1f\x7f]/.test(row.tutor))) throw new PortalRequestError(503);
  return { mode: row.mode as Opening["mode"], tutor: row.tutor as string | null };
}

async function loadReading(assigned: Assigned, kind: StudyKind, signal: AbortSignal): Promise<BookletReading | null> {
  const reading = assigned.readings.find(row => row.kind === kind);
  if (!reading) return null;
  const verses: StudyVerse[] = [], chapters: StudyChapter[] = [];
  let offset: number | null = 0;
  for (let page = 0; offset !== null; page++) {
    if (page === MAX_PAGES) throw new PortalRequestError(503);
    const value = await fetchStudyPage(assigned, kind, offset, signal);
    verses.push(...value.verses); chapters.push(...value.chapters.filter(chapter => !chapters.some(row => row.ref === chapter.ref))); offset = value.nextOffset;
  }
  const guide = await fetchGuide(assigned, kind, { type: "view" }, signal) as GuideFetch;
  return { reading, text: { verses, chapters }, guide: guide.view };
}

async function loadParts(mode: Opening["mode"], assigned: Assigned, signal: AbortSignal): Promise<BookletPart[]> {
  const metadata = await serviceApi.metadata(mode, assigned.student.id, signal);
  if (metadata.state !== "assigned") return [];
  const slot = assigned.student.serviceSlot === "havdalah" ? "havdalah" : "morning", parts: BookletPart[] = [];
  for (const unit of metadata.units) {
    const lesson = lessonForUnit(CRC_TENANT, unit.id), response = await serviceApi.unit(mode, assigned.student.id, metadata.plan, unit.id, signal);
    parts.push({ unitId: unit.id, name: unit.name, lesson, material: response.state === "assigned" ? response.material : null, teaching: lesson ? teachingOf(CRC_TENANT, lesson, slot) : null });
  }
  return parts;
}

export async function loadBooklet(studentId: string, signal: AbortSignal): Promise<BookletInput> {
  const opened = await openBooklet(studentId, signal);
  const assigned = await workspaceApi.reading(opened.mode, studentId, undefined, signal);
  const torah = await loadReading(assigned, "torah", signal), haftarah = await loadReading(assigned, "haftarah", signal);
  return { student: assigned.student, tutor: opened.tutor, torah, haftarah, parts: await loadParts(opened.mode, assigned, signal) };
}

/** Daniel's approved teaching, verbatim, with his credit, as the service course shows it. */
function TeachingText({ part }: { part: BookletPart }) {
  if (!part.teaching) return null;
  return <div className={booklet.teaching} data-approved={part.teaching.approved}>
    {part.teaching.text.split(/\n{2,}/).map((paragraph, i) => <p key={i}>{emphasised(typographic(paragraph)).map((piece, j) => piece.em ? <em key={j}>{piece.text}</em> : piece.text)}</p>)}
    <p className={booklet.credit}>{CRC_TENANT.credit}</p>
  </div>;
}
function Part({ part }: { part: BookletPart }) {
  return <section className={booklet.part} data-booklet-part={part.unitId}>
    <TeachingText part={part} />
    {part.material && <ServiceUnitView material={part.material} />}
  </section>;
}

/** The verses of one aliyah: Hebrew (trope colour unless "Black and white") beside the JPS 2023 English, then the guide's notes on them. */
function ReadingSection({ section, row, name, colour, productName, date }: { section: Extract<BookletSection, { kind: "reading" }>; row: BookletReading; name: string; colour: boolean; productName: string; date: string }) {
  const shortName = useIdentity().shortName;
  const ending = useMemo(() => ({ kind: row.reading.kind, confirmed: true, verses: row.reading.verses }), [row.reading]);
  const hebrew = colour ? (verse: StudyVerse) => {
    const result = colorStudyVerse(verse.ref, verse.hebrew, ending);
    const colors = result.status === "ready" ? result : null, id = `booklet-${verse.ref.replace(/[^A-Za-z0-9]+/g, "-")}`;
    // The phrase names the words point to, for a screen reader, as the reading page gives them; nothing of it prints.
    return <><StudyHebrew verse={verse} colors={colors} id={id} className={booklet.hebrew} />
      {colors && <div className={`sr-only ${styles.screenOnly}`} lang="en" dir="ltr"><PhraseLegend colors={colors} id={id} verseRef={verse.ref} /></div>}</>;
  } : undefined;
  return <>{section.aliyot.map((aliyah, index) => {
    const markers = new Map(aliyah.label ? [[aliyah.verses[0].ref, aliyah.label.replace(/^Aliyah /, "")]] : []);
    return <div key={index} className={booklet.aliyah} data-booklet-aliyah={aliyah.label ?? "reading"}>
      <PrintDocument heading={{ title: `${name} · ${kindName(section.reading)}`, passage: bookletRange(aliyah.verses), date }} text={{ verses: aliyah.verses, chapters: row.text.chapters }}
        markers={markers} format={BOOKLET_FORMAT} productName={productName} hebrew={hebrew} />
      {aliyah.notes.length > 0 && <section className={booklet.notes} aria-label={`Study notes, ${aliyah.label ?? kindName(section.reading)}`}>
        {aliyah.notes.map((note, i) => <article key={i} className={booklet.note} data-booklet-note={note.verseRef}>
          <p className={booklet.noteHead}><bdi dir="ltr">{note.verseRef}</bdi> · <bdi dir="auto">{note.theme}</bdi></p>
          <MarkdownLite text={note.note.body} className={booklet.prose} />
          {note.note.sources.length > 0 && <ul className={booklet.sources} aria-label="Sources for this note">{note.note.sources.map(source => <li key={source.id}>
            <bdi dir="auto">{source.labels.en ?? source.indexTitle}</bdi> · <bdi dir="ltr">{source.ref}</bdi></li>)}</ul>}
          <p className={booklet.label} data-guide-label={guideLabelState(note.label)}>{guideLabelText(note.label, shortName)}</p>
        </article>)}
      </section>}
    </div>;
  })}</>;
}

/** A Torah section is a top-level heading; the haftarah's sit under "The haftarah". */
const Sub = ({ kind, children }: { kind: BookletKind; children: ReactNode }) => kind === "torah" ? <h2 className={booklet.heading}>{children}</h2> : <h3 className={booklet.subheading}>{children}</h3>;
const SECTION_TITLES = { blessings: "Blessings before and after", service: "Your service parts", credits: "Credits" } as const;
const testId = (section: BookletSection) => section.kind === "about" || section.kind === "reading" || section.kind === "practice" ? `booklet-${section.kind}-${section.reading}` : `booklet-${section.kind}`;

/** The booklet itself, as it prints: one section to a page run, in the plan's order. Pure over its input, so the layout is testable. */
export function BookletDocument({ input, colour, productName }: { input: BookletInput; colour: boolean; productName: string }) {
  const shortName = useIdentity().shortName;
  const sections = useMemo(() => bookletSections(input, parashahName), [input]), name = `${input.student.firstName} ${input.student.lastName}`;
  const rowOf = (kind: BookletKind) => (kind === "torah" ? input.torah : input.haftarah)!;
  let haftarahOpened = false;
  return <article className={booklet.booklet} data-booklet-document data-colour={colour ? "trope" : "black-and-white"}>
    {sections.map(section => {
      const id = testId(section);
      const haftarahHead = section.kind !== "cover" && "reading" in section && section.reading === "haftarah" && !haftarahOpened ? (haftarahOpened = true) : false;
      const body = (() => {
        switch (section.kind) {
          case "cover": return <>
            <p className={booklet.eyebrow}>Beit Mitzvah</p>
            <h2 className={booklet.name}><bdi dir="auto">{bookletTitle(input.student.firstName, input.student.lastName)}</bdi></h2>
            <p className={booklet.meta}><time dateTime={section.ceremonyDate}>{longDate(section.ceremonyDate)}</time></p>
            {section.readings.map(reading => <div key={reading.kind} className={booklet.coverReading}>
              <p className={booklet.meta}>{kindName(reading.kind)}{reading.name ? <> · <bdi dir="auto">{reading.name}</bdi></> : null} · <bdi dir="ltr">{displayRange(reading.ranges)}</bdi></p>
              {reading.aliyot.length > 0 && <ul className={booklet.aliyot}>{reading.aliyot.map(line => <li key={line}><bdi dir="ltr">{line}</bdi></li>)}</ul>}
            </div>)}
            {section.rehearsals.length > 0 && <p className={booklet.meta}>Rehearsals: {section.rehearsals.map((date, i) => <Fragment key={date}>{i > 0 && " · "}<time dateTime={date}>{longDate(date)}</time></Fragment>)}</p>}
            {section.tutor && <p className={booklet.meta}>Tutor: <bdi dir="auto">{section.tutor}</bdi></p>}
          </>;
          case "blessings": return <>
            <h2 className={booklet.heading}>{SECTION_TITLES.blessings}</h2>
            {section.groups.map(group => <div key={group.kind} className={booklet.group} data-booklet-blessings={group.kind}>
              <h3 className={booklet.subheading}>{kindName(group.kind)} blessings</h3>
              <p className={booklet.meta}>Siddur page {group.page}</p>
              {group.parts.map(part => <Part key={part.unitId} part={part} />)}
            </div>)}
          </>;
          case "about": return <>
            <Sub kind={section.reading}>{section.reading === "torah" ? "About this portion" : "About this haftarah"}</Sub>
            <MarkdownLite text={section.overview} className={booklet.prose} />
            <p className={booklet.label} data-guide-label={guideLabelState(section.label)}>{guideLabelText(section.label, shortName)}</p>
          </>;
          case "reading": return <>
            <Sub kind={section.reading}>Your reading</Sub>
            <ReadingSection section={section} row={rowOf(section.reading)} name={name} colour={colour} productName={productName} date={input.student.ceremonyDate} />
          </>;
          case "practice": return <>
            <Sub kind={section.reading}>Practice page</Sub>
            <PrintDocument heading={{ title: `${name} · ${kindName(section.reading)}`, passage: displayRange(section.ranges), date: input.student.ceremonyDate }}
              text={{ verses: section.verses, chapters: rowOf(section.reading).text.chapters }} markers={new Map()} format={PRACTICE_FORMAT} productName={productName} />
          </>;
          case "service": return <>
            <h2 className={booklet.heading}>{SECTION_TITLES.service}</h2>
            {section.parts.map(part => <Part key={part.unitId} part={part} />)}
          </>;
          case "credits": return <>
            <h2 className={booklet.heading}>{SECTION_TITLES.credits}</h2>
            {(["torah", "haftarah"] as const).flatMap(kind => { const row = kind === "torah" ? input.torah : input.haftarah; return row ? sheetCredits(row.text, BOOKLET_FORMAT) : []; })
              .filter((line, i, all) => all.indexOf(line) === i).map(line => <p key={line} className={booklet.meta}>{line}</p>)}
            {section.tikkun && <p className={booklet.meta}>Practice pages: Stam Ashkenaz CLM, Culmus project (GNU GPL 2 with font exception).</p>}
            {section.teaching && <p className={booklet.meta}>{CRC_TENANT.credit}</p>}
            {[...new Set(section.guideLabels.map(l => guideLabelText(l, shortName)))].map(text => <p key={text} className={booklet.label}>{text}</p>)}
          </>;
        }
      })();
      return <Fragment key={id}>
        {haftarahHead && <h2 className={`${booklet.heading} ${booklet.partHead}`} data-testid="booklet-haftarah">The haftarah</h2>}
        <section className={`${booklet.section} ${section.kind === "cover" ? booklet.cover : ""}`} data-testid={id} data-booklet-section={section.kind}>{body}</section>
      </Fragment>;
    })}
  </article>;
}

const FACES = ['400 32px "CRC Taamey Frank"', '400 32px "CRC Stam Ashkenaz"', '400 32px "CRC Noto Serif Hebrew"'];
async function fontsReady() {
  for (const face of FACES) {
    const loaded = await document.fonts.load(face, "אבג");
    if (!loaded.length || !loaded.every(font => font.status === "loaded")) throw new Error("Booklet font unavailable");
  }
}
const PAGE_RULE = `@page reader-sheet { size: letter portrait; margin: 0.5in 0.55in 0.6in; @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8pt "Bricolage Grotesque", system-ui, sans-serif; color: #4b5a6b; } }`;

type Load = { key: number; status: "loading" } | { key: number; status: "ready"; input: BookletInput } | { key: number; status: "failed"; code: number };
export function BookletPage({ studentId }: { studentId: string }) {
  const productName = useProductName();
  const [retry, setRetry] = useState(0), [load, setLoad] = useState<Load>({ key: 0, status: "loading" }), [colour, setColour] = useState(true);
  const [printing, setPrinting] = useState<"idle" | "preparing" | "error">("idle"), gate = useRef(false);
  useEffect(() => {
    const controller = new AbortController(); setLoad({ key: retry, status: "loading" });
    loadBooklet(studentId, controller.signal).then(input => { if (!controller.signal.aborted) setLoad({ key: retry, status: "ready", input }); },
      error => { if (!controller.signal.aborted) setLoad({ key: retry, status: "failed", code: statusOf(error) }); });
    return () => controller.abort();
  }, [studentId, retry]);
  const ready = load.status === "ready" ? load.input : null, missing = load.status === "failed" && [400, 401, 403, 404].includes(load.code);
  const title = ready ? bookletTitle(ready.student.firstName, ready.student.lastName) : missing ? "Student not found" : "Study booklet";
  useDocumentTitle(pageTitle(productName, title));
  async function print() {
    if (gate.current || !ready) return;
    gate.current = true; setPrinting("preparing");
    try { await fontsReady(); setPrinting("idle"); window.print(); }
    catch { setPrinting("error"); }
    finally { gate.current = false; }
  }
  return <div className={`portal-shell ${styles.root}`}>
    <style>{PAGE_RULE}</style>
    <SiteBar mode="minimal" productName={productName} className={styles.screenOnly} />
    <main className="workspace-main">
      <header className={`reading-hero ${styles.screenOnly}`}>
        <h1 className="hero-reference">{title}</h1>
        {ready && <div className="hero-actions">
          <button type="button" className={`button-start ${styles.printButton}`} disabled={printing === "preparing"} onClick={() => void print()}>{icons.print}<span>Print</span></button>
          <label className={`${styles.check} ${booklet.switch}`}><input type="checkbox" checked={!colour} onChange={event => setColour(!event.currentTarget.checked)} data-testid="booklet-black-and-white" /> Black and white</label>
        </div>}
        <p role="status" className={styles.status}>{load.status === "loading" ? "Preparing the booklet…" : printing === "preparing" ? "Getting the Hebrew ready to print…" : printing === "error" ? "The Hebrew lettering didn’t load. Reload the page, then print again." : ""}</p>
      </header>
      {missing && <div className="workspace-state" data-testid="booklet-not-found"><p>This student isn’t in your list. <a href="/mine">My Readings</a></p></div>}
      {load.status === "failed" && !missing && <div className="workspace-state" role="alert"><p>The booklet didn’t load. Check your connection and try again.</p>
        <button type="button" className="button-secondary" onClick={() => setRetry(value => value + 1)}>Try again</button></div>}
      {ready && <div className={styles.paperFrame}><div className={styles.paper} data-paper="letter" data-orientation="portrait">
        <BookletDocument input={ready} colour={colour} productName={productName} />
      </div></div>}
    </main>
  </div>;
}
