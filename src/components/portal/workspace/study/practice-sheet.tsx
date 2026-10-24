"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Assigned, Reading, Student } from "../api";
import { statusOf, useWorkspace } from "../provider";
import { aliyahPosition } from "../../../../lib/readings/aliyah-starts";
import { StudyHebrew, TikkunVerse } from "./annotations";
import { icons } from "./lift";
import { useReadingPrefs } from "../reading-prefs";
import type { StudyKind, StudyVerse } from "./api";
import type { StudyChapter } from "./credits";
import styles from "./practice-sheet.module.css";

// The practice sheet is the family's "booklet of their portion": the whole
// assigned reading, a verse per line, vowels and trope, aliyah markers, and an
// optional tikkun column. Browser print CSS only; nothing is rendered on a server.
// It is Hebrew only by design: this is the student's chanting sheet. Printing JPS 2023
// is licensed (Daniel, 2026-10-23: "JPS 2023 is fine in print", with the edition and its
// credit on each printed page); English in print is the reader's print sheet's job
// (/print, src/components/portal/print), which carries that credit on every page.

const MAX_PAGES = 10; // studyPlan bounds an assignment to 1,000 verses, 100 per page.
const displayRange = (ranges: readonly string[]) => ranges.join("; ").replace(/(\d)-(\d)/g, "$1–$2");
const longDate = (value: string | Date) => new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", ...(typeof value === "string" ? { timeZone: "UTC" } : {}) })
  .format(typeof value === "string" ? Date.parse(`${value}T00:00:00Z`) : value);
const verseLabel = (ref: string) => /([1-9]\d*:[1-9]\d*)$/.exec(ref)?.[1] ?? ref;

export type SheetText = { verses: StudyVerse[]; chapters: StudyChapter[] };

/** Pure printable document, so its layout is testable without a session. */
export function PracticeSheetDocument({ student, reading, text, tikkun, aliyahBreaks, printedOn }: {
  student: Pick<Student, "firstName" | "lastName" | "ceremonyDate">; reading: Pick<Reading, "kind" | "ranges" | "verses" | "aliyahStarts">; text: SheetText; tikkun: boolean; aliyahBreaks: boolean; printedOn: Date;
}) {
  const withTikkun = tikkun && reading.kind === "torah", group = useId();
  const markers = text.verses.map((verse, index) => { const position = aliyahPosition(reading.kind, reading.aliyahStarts, reading.verses, verse.ref); return position && (position.startsHere || index === 0) ? position.number : null; });
  const credited = new Set(text.chapters.flatMap(chapter => chapter.editions.map(edition => edition.key)));
  return <article className={styles.sheet} data-practice-sheet-document data-tikkun={withTikkun ? "on" : "off"} data-aliyah-breaks={aliyahBreaks ? "on" : "off"}>
    <header className={styles.header}>
      <p className={styles.eyebrow}>Beit Mitzvah</p>
      <h1 className={styles.name}><bdi dir="auto">{student.firstName} {student.lastName}</bdi></h1>
      <p className={styles.meta}><time dateTime={student.ceremonyDate}>{longDate(student.ceremonyDate)}</time></p>
      <p className={styles.meta}>{reading.kind === "torah" ? "Torah" : "Haftarah"} · <bdi dir="ltr">{displayRange(reading.ranges)}</bdi></p>
    </header>
    {withTikkun && <div className={styles.columns} aria-hidden="true"><span>With vowels and trope</span><span>Tikkun</span></div>}
    <ol className={styles.verses}>{text.verses.map((verse, index) => <li key={verse.ref} className={styles.row} data-verse-ref={verse.ref} data-aliyah={markers[index] ?? undefined}>
      {markers[index] !== null && <h2 className={styles.aliyah}>Aliyah {markers[index]}</h2>}
      <div className={styles.line}>
        <span className={styles.number}><bdi dir="ltr">{verseLabel(verse.ref)}</bdi></span>
        <StudyHebrew verse={verse} colors={null} id={`${group}-${index}`} className={styles.pointed} />
        {withTikkun && <p className={styles.tikkun}><TikkunVerse verse={verse} /></p>}
      </div>
    </li>)}</ol>
    <footer className={styles.footer}>
      <p>{credited.has("mam") && "Hebrew: Miqra according to the Masorah, via Sefaria (CC BY-SA 4.0)."}{withTikkun && " Tikkun lettering: Stam Ashkenaz CLM, Culmus project (GNU GPL 2 with font exception)."}</p>
      <p>Printed <time dateTime={printedOn.toISOString().slice(0, 10)}>{longDate(printedOn)}</time></p>
    </footer>
  </article>;
}

const faces = ['400 32px "CRC Noto Serif Hebrew"', '400 32px "CRC Stam Ashkenaz"'];
async function fontsReady(tikkun: boolean) {
  for (const face of tikkun ? faces : faces.slice(0, 1)) {
    const loaded = await document.fonts.load(face, "\u05d0\u05d1\u05d2");
    if (!loaded.length || !loaded.every(font => font.status === "loaded")) throw new Error("Sheet font unavailable");
  }
}

type Load = { status: "loading" } | { status: "ready"; text: SheetText } | { status: "error"; code: number };
/**
 * Preview and print the authorized reading. Text comes only through the
 * workspace's own study loader, so the same role, child-practice and
 * assignment checks apply; an authority failure closes the sheet and reports it.
 */
export function PracticeSheet({ baseline, initialKind, onClose, authorityFailed }: {
  baseline: Assigned; initialKind: StudyKind; onClose(): void; authorityFailed(status: number): void;
}) {
  const { readStudy, concealed } = useWorkspace(), heading = useId(), prefs = useReadingPrefs();
  const kinds = baseline.readings.map(row => row.kind), [kind, setKind] = useState<StudyKind>(kinds.includes(initialKind) ? initialKind : kinds[0]);
  const reading = baseline.readings.find(row => row.kind === kind)!;
  const [tikkun, setTikkun] = useState(prefs.tikkunView !== "off"), [aliyahBreaks, setAliyahBreaks] = useState(false), [retry, setRetry] = useState(0);
  const [load, setLoad] = useState<Load>({ status: "loading" }), [printState, setPrintState] = useState<"idle" | "preparing" | "error">("idle");
  const [host, setHost] = useState<HTMLElement | null>(null), panel = useRef<HTMLDivElement>(null), gate = useRef(false), alive = useRef(true);
  const failed = useRef(authorityFailed); failed.current = authorityFailed;
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const request = new AbortController(); setLoad({ status: "loading" });
    void (async () => {
      const verses: StudyVerse[] = [], chapters: StudyChapter[] = [];
      let offset: number | null = 0;
      for (let page = 0; offset !== null; page++) {
        if (page === MAX_PAGES) throw new Error("Reading too long to print");
        const value = await readStudy(baseline, kind, offset, request.signal);
        verses.push(...value.verses); chapters.push(...value.chapters.filter(chapter => !chapters.some(row => row.ref === chapter.ref))); offset = value.nextOffset;
      }
      if (!request.signal.aborted) setLoad({ status: "ready", text: { verses, chapters } });
    })().catch(error => {
      if (request.signal.aborted) return;
      const code = statusOf(error);
      if ([401, 403, 404].includes(code)) { failed.current(code); close.current(); return; }
      setLoad({ status: "error", code });
    });
    return () => request.abort();
  }, [readStudy, baseline, kind, retry]);
  // The sheet is a direct child of <body> so print CSS can set everything else aside.
  useLayoutEffect(() => {
    const node = document.createElement("div"); node.className = `practice-sheet-host ${styles.host}`; node.dataset.practiceSheet = "";
    document.body.append(node); setHost(node);
    const quieted = [...document.body.children].filter((child): child is HTMLElement => child !== node && child instanceof HTMLElement && !child.inert);
    for (const child of quieted) child.inert = true;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => { for (const child of quieted) child.inert = false; node.remove(); if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);
  useLayoutEffect(() => { if (host) panel.current?.querySelector<HTMLElement>(`#${CSS.escape(heading)}`)?.focus({ preventScroll: true }); }, [host, heading]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !gate.current) { event.preventDefault(); close.current(); } };
    document.addEventListener("keydown", escape); return () => document.removeEventListener("keydown", escape);
  }, []);
  async function print() {
    if (gate.current || load.status !== "ready") return;
    gate.current = true; setPrintState("preparing");
    try { await fontsReady(tikkun && kind === "torah"); if (alive.current) { setPrintState("idle"); window.print(); } }
    catch { if (alive.current) setPrintState("error"); }
    finally { gate.current = false; }
  }
  if (!host || concealed) return null;
  return createPortal(<div ref={panel} className={styles.panel} role="dialog" aria-modal="true" aria-labelledby={heading}>
    <div className={styles.controls} data-practice-sheet-controls>
      <div className={styles.controlsHead}>
        <h2 id={heading} tabIndex={-1}>Practice sheet</h2>
        <button type="button" className="sheet-close" aria-label="Close practice sheet" onClick={onClose}>{icons.close}</button>
      </div>
      <p className={styles.lede}>Large print, a verse to a line, with vowels and trope. Print it, or save it as a PDF from the print window.</p>
      {kinds.length > 1 && <div className="study-kind-choice" role="group" aria-label="Reading to print">{baseline.readings.map(row => <button key={row.kind} type="button" className="button-secondary" aria-pressed={kind === row.kind} onClick={() => setKind(row.kind)}>{row.kind === "torah" ? "Torah" : "Haftarah"}</button>)}</div>}
      <div className={styles.options}>
        {kind === "torah" && <label className={styles.option}><input type="checkbox" checked={tikkun} onChange={event => setTikkun(event.currentTarget.checked)} /> Include a tikkun column</label>}
        {kind === "torah" && reading.aliyahStarts !== null && <label className={styles.option}><input type="checkbox" checked={aliyahBreaks} onChange={event => setAliyahBreaks(event.currentTarget.checked)} /> Start each aliyah on a new page</label>}
      </div>
      <div className={styles.actions}>
        <button type="button" className="button-primary" disabled={load.status !== "ready" || printState === "preparing"} onClick={() => void print()}>{icons.print}<span>Print</span></button>
        <button type="button" className="button-secondary" onClick={onClose}>Back to reading</button>
      </div>
      <p role="status" className="field-help">{load.status === "loading" ? "Preparing your reading…" : load.status === "error" ? "The verses didn’t load. Check your connection and try again." : printState === "preparing" ? "Getting the Hebrew ready to print…" : printState === "error" ? "The Hebrew lettering didn’t load. Reload the page, then print again." : ""}</p>
      {load.status === "error" && <button type="button" className="button-secondary" onClick={() => setRetry(value => value + 1)}>Try again</button>}
    </div>
    {load.status === "ready" && <div className={styles.paper}><PracticeSheetDocument student={baseline.student} reading={reading} text={load.text} tikkun={tikkun} aliyahBreaks={aliyahBreaks} printedOn={new Date()} /></div>}
  </div>, host);
}
