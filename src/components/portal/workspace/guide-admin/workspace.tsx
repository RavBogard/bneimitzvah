"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { RequireRole, statusOf } from "../provider";
import { Button, ButtonLink, Chip, EmptyState, PageHeader, Sheet, type ChipTone, type ConfirmSpec } from "../../../ui";
import { guideLabelText } from "../study/guide-card";
import { MarkdownLite } from "../study/markdown-lite";
import { sectionLabel } from "../../../../lib/readings/sections";
import { useIdentity } from "../../../site/identity-context";
import { guideAdminApi, type DiscussionRow, type GuideRow, type GuideVersionInfo, type GuideText, type Overview, type SummaryRow, type WriteOutcome } from "./api";
import styles from "./guide-admin.module.css";

/**
 * The admin's Guides page (gap A6, Daniel 2026-11-17): every study guide, discussion and portion summary of this congregation, held
 * drafts and unapproved summaries first. See, release, hold, approve and withdraw; nothing here edits text or marks a guide reviewed.
 * A guide's release or hold copies the version shown, as stored (migration 0058; see server/guide-admin/service.ts).
 */
export function GuideAdminWorkspace() { return <RequireRole role="admin"><GuideAdminPage /></RequireRole>; }

type Item = { type: "guide"; row: GuideRow } | { type: "summary"; row: SummaryRow } | { type: "discussion"; row: DiscussionRow };
type Group = { key: string; name: string; order: number; items: Item[] };
export type Actions = {
  releaseGuide(row: GuideRow): Promise<void>;
  holdGuide(row: GuideRow): Promise<void>;
  withdrawDiscussion(row: DiscussionRow): Promise<void>;
  approveSummary(row: SummaryRow): Promise<void>;
  withdrawSummary(row: SummaryRow): Promise<void>;
};

const day = (value: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
const kindName = (kind: "torah" | "haftarah") => kind === "torah" ? "Torah" : "Haftarah";
const itemKey = (item: Item) => item.type === "guide" ? `guide:${item.row.kind}:${item.row.readingKey}` : item.type === "summary" ? `summary:${item.row.reading}:${item.row.revision}` : `discussion:${item.row.slug}`;
const readingOf = (item: Item) => item.type === "summary" ? item.row.readingPlace : item.row.reading;
const contentStatuses = ["held", "draft", "reviewed", "approved", "published", "withdrawn"] as const;
type ContentStatus = (typeof contentStatuses)[number];
type GuideFilters = { query: string; status: ContentStatus | ""; waitingPage: number; catalogPage: number };
const initialFilters: GuideFilters = { query: "", status: "", waitingPage: 1, catalogPage: 1 };
const pageSize = 10;
const searchText = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").trim().toLowerCase();
const isStatus = (value: string): value is ContentStatus => contentStatuses.some(status => status === value);
const statusOfItem = (item: Item) => item.type === "guide" ? item.row.state : item.row.status;

function matchesFilters(item: Item, filters: { query: string; status: ContentStatus | "" }) {
  if (filters.status && statusOfItem(item) !== filters.status) return false;
  const reading = readingOf(item);
  const name = reading?.name ?? (item.type === "guide" ? item.row.readingKey : item.type === "summary" ? item.row.reading : "Other readings");
  return [name, reading?.slug ?? ""].some(value => searchText(value).includes(filters.query));
}

/** Held guide drafts and summary drafts wait for the rabbi and come first; everything else is grouped by reading, in calendar order. */
export function arrange(overview: Overview, { query, status }: Pick<GuideFilters, "query" | "status"> = initialFilters): { waiting: Item[]; groups: Group[] } {
  const filters = { query: searchText(query), status };
  const items: Item[] = [...overview.guides.map(row => ({ type: "guide" as const, row })), ...overview.summaries.map(row => ({ type: "summary" as const, row })),
    ...overview.discussions.map(row => ({ type: "discussion" as const, row }))].filter(item => matchesFilters(item, filters));
  const waits = (item: Item) => item.type === "guide" ? item.row.state === "held" : item.type === "summary" && item.row.status === "draft";
  const order = (item: Item) => readingOf(item)?.order ?? Number.MAX_SAFE_INTEGER;
  const waiting = items.filter(waits).sort((a, b) => order(a) - order(b));
  const groups = new Map<string, Group>();
  for (const item of items.filter(item => !waits(item))) {
    const reading = readingOf(item), key = reading?.slug ?? "other";
    const group = groups.get(key) ?? { key, name: reading?.name ?? "Other readings", order: reading?.order ?? Number.MAX_SAFE_INTEGER, items: [] };
    group.items.push(item); groups.set(key, group);
  }
  const rank = { guide: 0, summary: 1, discussion: 2 } as const;
  for (const group of groups.values()) group.items.sort((a, b) => rank[a.type] - rank[b.type]);
  return { waiting, groups: [...groups.values()].sort((a, b) => a.order - b.order) };
}

function pageBounds(total: number, requested: number) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requested, pages);
  return { page, pages, start: (page - 1) * pageSize };
}

function ResultPages({ label, page, pages, onPage }: { label: string; page: number; pages: number; onPage(next: number): void }) {
  if (pages === 1) return null;
  return <nav className={styles.actions} aria-label={label}>
    <Button disabled={page === 1} onClick={() => onPage(page - 1)}>Previous</Button>
    <span className={styles.pageNumber}>Page {page} of {pages}</span>
    <Button disabled={page === pages} onClick={() => onPage(page + 1)}>Next</Button>
  </nav>;
}

type GuideScroll = { row: string; top: number };
function readFilters(): GuideFilters {
  const params = new URLSearchParams(location.search), status = params.get("status") ?? "";
  const page = (name: string) => {
    const value = Number(params.get(name));
    return Number.isSafeInteger(value) && value > 0 ? value : 1;
  };
  return { query: (params.get("reading") ?? "").slice(0, 100), status: isStatus(status) ? status : "",
    waitingPage: page("waitingPage"), catalogPage: page("catalogPage") };
}

function replaceFilters(filters: GuideFilters) {
  const url = new URL(location.href);
  for (const [name, value] of [["reading", filters.query], ["status", filters.status], ["waitingPage", filters.waitingPage], ["catalogPage", filters.catalogPage]] as const) {
    if (!value || value === 1) url.searchParams.delete(name);
    else url.searchParams.set(name, String(value));
  }
  history.replaceState({}, "", url);
}

const GUIDE_CHIP: Record<GuideRow["state"], [string, ChipTone]> = { reviewed: ["Reviewed", "done"], draft: ["Draft", "info"], held: ["Held", "attention"] };
const SUMMARY_CHIP: Record<SummaryRow["status"], [string, ChipTone]> = { approved: ["Approved", "done"], draft: ["Draft", "attention"], withdrawn: ["Withdrawn", "neutral"] };
const DISCUSSION_CHIP: Record<DiscussionRow["status"], [string, ChipTone]> = { published: ["Published", "done"], withdrawn: ["Withdrawn", "neutral"] };

function GuideTextView({ text }: { text: GuideText }) {
  return <div className={styles.text} data-testid="guide-admin-text">
    {text.body.overview && <MarkdownLite text={text.body.overview} heClass={styles.he} />}
    {text.body.themes.map(theme => <section key={theme.id}>
      <h4 dir="auto">{theme.title}</h4>
      <MarkdownLite text={theme.intro} heClass={styles.he} />
      {theme.notes.map((note, i) => <div key={`${note.verseRef}-${i}`}>
        <h5>{note.verseRef}</h5>
        <MarkdownLite text={note.body} heClass={styles.he} />
        {note.sources.length > 0 && <p className={styles.sources}>Sources: {note.sources.map(source => source.ref).join("; ")}</p>}
      </div>)}
    </section>)}
  </div>;
}

/** The full text of one guide version, read only, fetched when the fold first opens. */
function GuideTextFold({ row, version }: { row: GuideRow; version: number }) {
  const [state, setState] = useState<{ text?: GuideText; failed?: boolean } | null>(null);
  const load = useCallback(() => {
    setState({});
    guideAdminApi.guideText({ kind: row.kind, readingKey: row.readingKey, version }).then(text => setState({ text }), () => setState({ failed: true }));
  }, [row.kind, row.readingKey, version]);
  return <details className={styles.fold} onToggle={event => { if (event.currentTarget.open && !state) load(); }}>
    <summary>Read version {version}</summary>
    {state?.text ? <GuideTextView text={state.text} />
      : state?.failed ? <p role="alert" className="request-error">The text could not be loaded. <Button variant="quiet" onClick={load}>Try again</Button></p>
        : <p className={styles.meta}>Loading</p>}
  </details>;
}

/**
 * What readers will see, in full, for the release and hold confirmations: the version, who it is written by, whether it is reviewed,
 * and the label readers see on it.
 */
function readersSee(info: GuideVersionInfo, rabbiName: string, shortName: string) {
  const writer = info.importedFrom ?? (info.origin === "rabbi" ? rabbiName : "Claude");
  const label = guideLabelText({ origin: info.origin, reviewed: info.reviewed, rabbiName, ...(info.importedFrom ? { importedFrom: info.importedFrom } : {}) }, shortName);
  return `version ${info.version}, written by ${writer}, ${info.reviewed ? "reviewed" : "not reviewed"}. Its label reads "${label}."`;
}
export function releaseDescription(row: GuideRow, rabbiName: string, shortName: string) {
  return `Readers then see ${readersSee(row.current, rabbiName, shortName)}${row.visible ? ` It takes the place of version ${row.visible.version}.` : ""}`;
}
export function holdDescription(row: GuideRow, rabbiName: string, shortName: string) {
  return row.afterHold ? `Readers then see ${readersSee(row.afterHold, rabbiName, shortName)} Version ${row.current.version} stays held until it is released again.`
    : `Readers then see no guide for this reading until version ${row.current.version} is released again.`;
}

/** A release is not destructive, so it does not take the danger tone; it asks in the same confirm sheet the destructive buttons use. */
function ConfirmedButton({ confirm, children, ...rest }: { confirm: ConfirmSpec; children: string; "data-testid": string }) {
  const [asking, setAsking] = useState(false), [busy, setBusy] = useState(false), cancel = useRef<HTMLButtonElement>(null);
  async function confirmed() {
    if (busy) return;
    setBusy(true);
    try { await confirm.onConfirm(); } finally { setBusy(false); setAsking(false); }
  }
  return <>
    <Button {...rest} variant="primary" aria-haspopup="dialog" onClick={() => setAsking(true)}>{children}</Button>
    <Sheet open={asking} onClose={() => { if (!busy) setAsking(false); }} title={confirm.title} dismissible={!busy} initialFocus={cancel}
      footer={<>
        <Button ref={cancel} onClick={() => setAsking(false)} disabled={busy}>{confirm.cancelLabel}</Button>
        <Button variant="primary" onClick={() => void confirmed()} disabled={busy} aria-busy={busy || undefined}>{confirm.confirmLabel}</Button>
      </>}>
      {confirm.description && <div>{confirm.description}</div>}
    </Sheet>
  </>;
}

function GuideItem({ row, rabbiName, actions }: { row: GuideRow; rabbiName: string; actions: Actions }) {
  const shortName = useIdentity().shortName, [chip, tone] = GUIDE_CHIP[row.state];
  const label = guideLabelText({ origin: row.current.origin, reviewed: row.current.reviewed, rabbiName, ...(row.current.importedFrom ? { importedFrom: row.current.importedFrom } : {}) }, shortName);
  return <li className={styles.item} data-testid="guide-admin-guide" data-state={row.state} data-key={`${row.kind}:${row.readingKey}`} data-guide-scroll={itemKey({ type: "guide", row })}>
    <div className={styles.head}><p className={styles.title}>Study guide · {kindName(row.kind)}{row.reading ? ` · ${row.reading.name}` : ""}</p><Chip tone={tone}>{chip}</Chip></div>
    <p className={styles.meta}>Version {row.current.version} · {label} · changed {day(row.current.changedAt)}</p>
    {row.state === "held" && <p className={styles.meta}>{row.visible ? `Readers see version ${row.visible.version} until this draft is released.` : "Readers see no guide for this reading until this draft is released."}</p>}
    <GuideTextFold key={row.current.version} row={row} version={row.current.version} />
    <div className={styles.actions}>
      {row.href && <ButtonLink variant="quiet" href={row.href} data-testid="guide-admin-open">Open the study page</ButtonLink>}
      {/* Release and hold copy version N exactly as stored; neither changes its text or marks it reviewed. */}
      {row.state === "held"
        ? <ConfirmedButton data-testid="guide-admin-release"
          confirm={{ title: `Release version ${row.current.version}?`, description: releaseDescription(row, rabbiName, shortName),
            confirmLabel: "Release", cancelLabel: "Not now", onConfirm: () => actions.releaseGuide(row) }}>Release</ConfirmedButton>
        : <Button destructive variant="secondary" data-testid="guide-admin-hold"
          confirm={{ title: `Hold version ${row.current.version}?`, description: holdDescription(row, rabbiName, shortName),
            confirmLabel: "Hold", cancelLabel: "Not now", onConfirm: () => actions.holdGuide(row) }}>Hold</Button>}
    </div>
  </li>;
}

function SummaryItem({ row, actions }: { row: SummaryRow; actions: Actions }) {
  const [chip, tone] = SUMMARY_CHIP[row.status], name = row.readingPlace?.name ?? row.reading;
  return <li className={styles.item} data-testid="guide-admin-summary" data-status={row.status} data-key={`${row.reading}:${row.revision}`} data-guide-scroll={itemKey({ type: "summary", row })}>
    <div className={styles.head}><p className={styles.title}>Portion summary · {name}</p><Chip tone={tone}>{chip}</Chip></div>
    <p className={styles.meta}>Revision {row.revision}{row.credit ? ` · credited ${row.credit}` : row.importedFrom ? ` · from ${row.importedFrom}` : ""} · changed {day(row.changedAt)}</p>
    <details className={styles.fold}>
      <summary>Read revision {row.revision}</summary>
      <div className={styles.text} data-testid="guide-admin-summary-text">
        <MarkdownLite text={row.summary} heClass={styles.he} />
        <ol className={styles.outline}>{row.outline.map(line => <li key={line.aliyah}><span className={styles.label}>{sectionLabel(String(line.aliyah))}</span><span dir="auto">{line.line}</span></li>)}</ol>
      </div>
      {/* Approval is offered only here, under the exact text of this revision. */}
      {row.status !== "withdrawn" && <div className={styles.actions}>
        {row.status === "draft" && <Button variant="primary" data-testid="guide-admin-approve" onClick={() => void actions.approveSummary(row)}>Approve revision {row.revision}</Button>}
        <Button destructive variant="secondary" data-testid="guide-admin-withdraw-summary"
          confirm={{ title: `Withdraw revision ${row.revision}?`, description: row.status === "approved" ? "Readers stop seeing this summary within about ten minutes. It cannot be approved again; a new draft can." : "This draft is discarded and cannot be approved later.",
            confirmLabel: "Withdraw", cancelLabel: "Keep it", onConfirm: () => actions.withdrawSummary(row) }}>Withdraw</Button>
      </div>}
    </details>
    {row.href && <div className={styles.actions}><ButtonLink variant="quiet" href={row.href} data-testid="guide-admin-open">Open the study page</ButtonLink></div>}
  </li>;
}

function DiscussionItem({ row, actions }: { row: DiscussionRow; actions: Actions }) {
  const [chip, tone] = DISCUSSION_CHIP[row.status];
  return <li className={styles.item} data-testid="guide-admin-discussion" data-status={row.status} data-key={row.slug} data-guide-scroll={itemKey({ type: "discussion", row })}>
    <div className={styles.head}><p className={styles.title} dir="auto">Discussion · {row.title}</p><Chip tone={tone}>{chip}</Chip></div>
    <p className={styles.meta}>{kindName(row.kind)} · {row.sourceCount} {row.sourceCount === 1 ? "source" : "sources"} · changed {day(row.changedAt)}</p>
    {(row.href || row.status === "published") && <div className={styles.actions}>
      {row.href && <ButtonLink variant="quiet" href={row.href} data-testid="guide-admin-open">Open the study page</ButtonLink>}
      {row.status === "published" && <Button destructive variant="secondary" data-testid="guide-admin-withdraw-discussion"
        confirm={{ title: "Withdraw this discussion?", description: "Readers stop seeing it within about five minutes. It cannot be published again; a new one can be added through Claude.",
          confirmLabel: "Withdraw", cancelLabel: "Keep it", onConfirm: () => actions.withdrawDiscussion(row) }}>Withdraw</Button>}
    </div>}
  </li>;
}

function ItemView({ item, rabbiName, actions }: { item: Item; rabbiName: string; actions: Actions }) {
  return item.type === "guide" ? <GuideItem row={item.row} rabbiName={rabbiName} actions={actions} /> : item.type === "summary" ? <SummaryItem row={item.row} actions={actions} /> : <DiscussionItem row={item.row} actions={actions} />;
}

/** The loaded page, separate from loading so it renders on its own. */
export function GuidesView({ overview, actions }: { overview: Overview; actions: Actions }) {
  const [filters, setFilters] = useState(initialFilters), [loadedFilters, setLoadedFilters] = useState(false);
  const sections = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    setFilters(readFilters()); setLoadedFilters(true);
    const restore = () => setFilters(readFilters());
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  useLayoutEffect(() => {
    if (!loadedFilters) return;
    const saved = history.state?.guideScroll as GuideScroll | undefined;
    if (!saved || typeof saved.row !== "string" || !Number.isFinite(saved.top)) return;
    const link = sections.current?.querySelector(`[data-guide-scroll="${CSS.escape(saved.row)}"] [data-testid="guide-admin-open"]`);
    history.replaceState({}, "");
    if (link) window.scrollBy({ top: link.getBoundingClientRect().top - saved.top, behavior: "instant" });
  }, [loadedFilters]);
  function rememberPosition(event: MouseEvent<HTMLDivElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return;
    const link = event.target.closest('[data-testid="guide-admin-open"]'), row = link?.closest<HTMLElement>("[data-guide-scroll]")?.dataset.guideScroll;
    if (row && link) history.replaceState({ guideScroll: { row, top: link.getBoundingClientRect().top } }, "");
  }
  function change(next: GuideFilters) { setFilters(next); replaceFilters(next); }
  function filter(next: Partial<GuideFilters>) { change({ ...filters, ...next, waitingPage: 1, catalogPage: 1 }); }
  const { waiting, groups } = arrange(overview, filters);
  const total = overview.guides.length + overview.summaries.length + overview.discussions.length;
  if (!total) return <EmptyState title="No study content yet" description="Study guides, discussions and portion summaries appear here once they are written through Claude." />;
  const catalogTotal = groups.reduce((count, group) => count + group.items.length, 0);
  const resultCount = waiting.length + catalogTotal;
  const waitingPage = pageBounds(waiting.length, filters.waitingPage), catalogPage = pageBounds(catalogTotal, filters.catalogPage);
  let groupStart = 0;
  const visibleGroups = groups.flatMap(group => {
    const items = group.items.slice(Math.max(0, catalogPage.start - groupStart), Math.max(0, catalogPage.start + pageSize - groupStart));
    groupStart += group.items.length;
    return items.length ? [{ ...group, items }] : [];
  });
  return <div ref={sections} onClickCapture={rememberPosition}>
    <div className={styles.filters}>
      <label>Reading name
        <input type="search" value={filters.query} maxLength={100} onChange={event => filter({ query: event.target.value })} />
      </label>
      <label>Content status
        <select value={filters.status} onChange={event => { const value = event.target.value; filter({ status: isStatus(value) ? value : "" }); }}>
          <option value="">All statuses</option>
          {contentStatuses.map(status => <option key={status} value={status}>{status.charAt(0).toUpperCase() + status.slice(1)}</option>)}
        </select>
      </label>
      <Button variant="quiet" disabled={!filters.query && !filters.status} onClick={() => change(initialFilters)}>Clear filters</Button>
    </div>
    <p role="status" className={styles.meta} data-testid="guide-admin-count">{resultCount} {resultCount === 1 ? "result" : "results"}{resultCount < total ? ` of ${total}` : ""}</p>
    {!resultCount && <EmptyState title="No matching study content" description="Try another reading name or clear the filters." />}
    {waiting.length > 0 && <section className={styles.section} aria-labelledby="guide-admin-waiting" data-testid="guide-admin-waiting">
      <h2 id="guide-admin-waiting">Waiting for {overview.rabbiName}</h2>
      <p className={styles.note}>Held guide drafts and unapproved portion summaries. Readers do not see these yet.</p>
      <ul className={styles.items}>{waiting.slice(waitingPage.start, waitingPage.start + pageSize).map(item => <ItemView key={itemKey(item)} item={item} rabbiName={overview.rabbiName} actions={actions} />)}</ul>
      <ResultPages {...waitingPage} label="Waiting results pages" onPage={waitingPage => change({ ...filters, waitingPage })} />
    </section>}
    {groups.length > 0 && <section className={styles.section} aria-labelledby="guide-admin-readings" data-testid="guide-admin-readings">
      <h2 id="guide-admin-readings">By reading</h2>
      {visibleGroups.map(group => <section key={group.key} className={styles.group} aria-label={group.name} data-testid="guide-admin-group">
        <h3>{group.name}</h3>
        <ul className={styles.items}>{group.items.map(item => <ItemView key={itemKey(item)} item={item} rabbiName={overview.rabbiName} actions={actions} />)}</ul>
      </section>)}
      <ResultPages {...catalogPage} label="Reading results pages" onPage={catalogPage => change({ ...filters, catalogPage })} />
    </section>}
    {overview.truncated && <p className={styles.note} data-testid="guide-admin-truncated">Only the most recent items are listed.</p>}
  </div>;
}

const NOT_ALLOWED = "This is not allowed right now. You may need to sign in again.";
const REFUSED: Record<string, string> = {
  conflict: "This changed since the page loaded. The list now shows the latest.",
  "not-found": "That could not be found. The list now shows the latest.",
  withdrawn: "That was already withdrawn. The list now shows the latest.",
  "not-draft": "That revision is already approved. The list now shows the latest.",
  "no-credit": "This congregation has no portion summary credit set, so nothing can be approved yet.",
  "not-held": "That version is no longer held. The list now shows the latest.",
  "not-released": "That version is already held. The list now shows the latest.",
  invalid: "That version no longer meets the guide rules. Save a corrected version through Claude.",
};

function GuideAdminPage() {
  const [overview, setOverview] = useState<Overview | null>(null), [failed, setFailed] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "status" | "alert" } | null>(null);
  const actionScroll = useRef<number | null>(null);
  useLayoutEffect(() => {
    const top = actionScroll.current;
    if (top !== null) { actionScroll.current = null; window.scrollTo({ top, behavior: "instant" }); }
  }, [overview]);
  const load = useCallback(async (signal?: AbortSignal) => {
    try { const next = await guideAdminApi.overview(signal); if (!signal?.aborted) { setOverview(next); setFailed(false); } }
    catch { if (!signal?.aborted) setFailed(true); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  async function act(run: () => Promise<WriteOutcome>, done: string) {
    setMessage(null);
    try {
      const result = await run();
      setMessage(result.ok ? { text: done, tone: "status" } : { text: REFUSED[result.code] ?? "That did not go through. Try again.", tone: "alert" });
    } catch (error) { setMessage({ text: statusOf(error) === 401 || statusOf(error) === 403 ? NOT_ALLOWED : "That did not go through. Try again.", tone: "alert" }); }
    actionScroll.current = window.scrollY;
    await load();
  }
  const actions: Actions = {
    releaseGuide: row => act(() => guideAdminApi.releaseGuide({ kind: row.kind, readingKey: row.readingKey, version: row.current.version }), "Guide released."),
    holdGuide: row => act(() => guideAdminApi.holdGuide({ kind: row.kind, readingKey: row.readingKey, version: row.current.version }), "Guide held."),
    withdrawDiscussion: row => act(() => guideAdminApi.withdrawDiscussion(row.slug, row.revision), "Discussion withdrawn. Readers stop seeing it within about five minutes."),
    approveSummary: row => act(() => guideAdminApi.approveSummary(row.reading, row.revision), "Summary approved. Readers see it within about ten minutes."),
    withdrawSummary: row => act(() => guideAdminApi.withdrawSummary(row.reading, row.revision), "Summary withdrawn."),
  };
  return <section className="role-workspace admin-workspace settings-workspace" data-testid="guide-admin">
    <PageHeader title="Guides" />
    <p className={styles.note}>Study guides, discussions and portion summaries, as readers see them. Writing and editing happen through Claude; here you can release, hold, approve or withdraw.</p>
    {message && <p className={message.tone === "alert" ? "request-error roster-message" : "workspace-notice roster-message"} role={message.tone} data-testid="guide-admin-message">{message.text}</p>}
    {failed && !overview ? <div role="alert" className="request-error" data-testid="guide-admin-failed"><p>The guides could not be loaded.</p><Button onClick={() => { setFailed(false); void load(); }}>Try again</Button></div>
      : overview ? <GuidesView overview={overview} actions={actions} /> : <p className={styles.meta} role="status">Loading</p>}
  </section>;
}
