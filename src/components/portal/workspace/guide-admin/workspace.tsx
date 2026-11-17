"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { RequireRole, statusOf } from "../provider";
import { Button, ButtonLink, Chip, EmptyState, PageHeader, Sheet, type ChipTone, type ConfirmSpec } from "../../../ui";
import { guideLabelText } from "../study/guide-card";
import { MarkdownLite } from "../study/markdown-lite";
import { sectionLabel } from "../../../../lib/readings/sections";
import { useIdentity } from "../../../site/identity-context";
import { guideAdminApi, type DiscussionRow, type GuideRow, type GuideText, type Overview, type SummaryRow, type WriteOutcome } from "./api";
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

/** Held guide drafts and summary drafts wait for the rabbi and come first; everything else is grouped by reading, in calendar order. */
export function arrange(overview: Overview): { waiting: Item[]; groups: Group[] } {
  const items: Item[] = [...overview.guides.map(row => ({ type: "guide" as const, row })), ...overview.summaries.map(row => ({ type: "summary" as const, row })),
    ...overview.discussions.map(row => ({ type: "discussion" as const, row }))];
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
  return <li className={styles.item} data-testid="guide-admin-guide" data-state={row.state} data-key={`${row.kind}:${row.readingKey}`}>
    <div className={styles.head}><p className={styles.title}>Study guide · {kindName(row.kind)}{row.reading ? ` · ${row.reading.name}` : ""}</p><Chip tone={tone}>{chip}</Chip></div>
    <p className={styles.meta}>Version {row.current.version} · {label} · changed {day(row.current.changedAt)}</p>
    {row.state === "held" && <p className={styles.meta}>{row.visible ? `Readers see version ${row.visible.version} until this draft is released.` : "Readers see no guide for this reading until this draft is released."}</p>}
    <GuideTextFold row={row} version={row.current.version} />
    <div className={styles.actions}>
      {row.href && <ButtonLink variant="quiet" href={row.href} data-testid="guide-admin-open">Open the study page</ButtonLink>}
      {/* Release and hold copy version N exactly as stored; neither changes its text or marks it reviewed. */}
      {row.state === "held"
        ? <ConfirmedButton data-testid="guide-admin-release"
          confirm={{ title: `Release version ${row.current.version}?`, description: `Readers then see version ${row.current.version} of this guide${row.visible ? ` in place of version ${row.visible.version}` : ""}, labeled as it is now.`,
            confirmLabel: "Release", cancelLabel: "Not now", onConfirm: () => actions.releaseGuide(row) }}>Release</ConfirmedButton>
        : <Button destructive variant="secondary" data-testid="guide-admin-hold"
          confirm={{ title: `Hold version ${row.current.version}?`, description: row.afterHold ? `Readers go back to version ${row.afterHold.version} until this one is released again.` : "Readers see no guide for this reading until this one is released again.",
            confirmLabel: "Hold", cancelLabel: "Not now", onConfirm: () => actions.holdGuide(row) }}>Hold</Button>}
    </div>
  </li>;
}

function SummaryItem({ row, actions }: { row: SummaryRow; actions: Actions }) {
  const [chip, tone] = SUMMARY_CHIP[row.status], name = row.readingPlace?.name ?? row.reading;
  return <li className={styles.item} data-testid="guide-admin-summary" data-status={row.status} data-key={`${row.reading}:${row.revision}`}>
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
  return <li className={styles.item} data-testid="guide-admin-discussion" data-status={row.status} data-key={row.slug}>
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
  const { waiting, groups } = arrange(overview);
  if (!waiting.length && !groups.length) return <EmptyState title="No study content yet" description="Study guides, discussions and portion summaries appear here once they are written through Claude." />;
  return <>
    {waiting.length > 0 && <section className={styles.section} aria-labelledby="guide-admin-waiting" data-testid="guide-admin-waiting">
      <h2 id="guide-admin-waiting">Waiting for {overview.rabbiName}</h2>
      <p className={styles.note}>Held guide drafts and unapproved portion summaries. Readers do not see these yet.</p>
      <ul className={styles.items}>{waiting.map(item => <ItemView key={itemKey(item)} item={item} rabbiName={overview.rabbiName} actions={actions} />)}</ul>
    </section>}
    {groups.length > 0 && <section className={styles.section} aria-labelledby="guide-admin-readings" data-testid="guide-admin-readings">
      <h2 id="guide-admin-readings">By reading</h2>
      {groups.map(group => <section key={group.key} className={styles.group} aria-label={group.name} data-testid="guide-admin-group">
        <h3>{group.name}</h3>
        <ul className={styles.items}>{group.items.map(item => <ItemView key={itemKey(item)} item={item} rabbiName={overview.rabbiName} actions={actions} />)}</ul>
      </section>)}
    </section>}
    {overview.truncated && <p className={styles.note} data-testid="guide-admin-truncated">Only the most recent items are listed.</p>}
  </>;
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
