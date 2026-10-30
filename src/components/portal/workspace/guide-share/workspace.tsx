"use client";
import { useRef, useState, type ChangeEvent } from "react";
import { RequireRole, statusOf, WorkspaceLink } from "../provider";
import { guideShareApi, type Item, type Outcome } from "./api";
import { Button, PageHeader } from "../../../ui";

// Why an item could not be placed, in plain words. Keyed by the server's reason codes, which tests assert instead of this wording.
const REASONS: Record<string, string> = {
  "already-imported": "Already imported.",
  "has-guide": "You already have a guide for this reading, so it was left alone.",
  "not-in-catalog": "This portal has no such reading.",
  "verse-outside-reading": "A note sits on a verse outside this reading.",
  "citations-unchecked": "Its sources could not be checked just now.",
  "invalid": "It does not meet this portal’s guide rules.",
  "not-a-parashah": "Not a parashah this portal has.",
  "cannot-arrive-held": "Discussions cannot be held for review yet, so this one was not imported.",
};
const NOT_ALLOWED = "This isn’t allowed right now. You may need to sign in again.";

export function GuideSharingWorkspace() { return <RequireRole role="admin"><GuideSharingPage /></RequireRole>; }

function Group({ id, title, items }: { id: string; title: string; items: Item[] }) {
  if (!items.length) return null;
  const ready = items.filter(item => item.status === "ready").length;
  return <section className="people-card" aria-labelledby={`guide-share-${id}`} data-testid={`guide-share-${id}`}>
    <div className="people-card-head"><h2 id={`guide-share-${id}`}>{title}</h2><p>{ready} of {items.length} can be imported.</p></div>
    <ul>{items.map(item => <li key={item.label} data-status={item.status} data-reason={item.reason ?? undefined}>{item.label}
      {item.status === "skipped" && item.reason ? ` — ${REASONS[item.reason] ?? "Not imported."}` : ""}
      {item.dropped > 0 ? ` — ${item.dropped} source${item.dropped === 1 ? "" : "s"} this portal could not confirm will be left out.` : ""}</li>)}</ul>
  </section>;
}

function GuideSharingPage() {
  const [file, setFile] = useState<unknown>(null), [name, setName] = useState(""), [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pending, setPending] = useState(false), [message, setMessage] = useState<{ text: string; tone: "status" | "alert" } | null>(null), [done, setDone] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    setFile(null); setOutcome(null); setMessage(null); setDone(false); setName(chosen?.name ?? "");
    if (!chosen) return;
    if (chosen.size > guideShareApi.maxBytes) { setMessage({ text: "That file is too large to import.", tone: "alert" }); return; }
    let parsed: unknown;
    try { parsed = JSON.parse(await chosen.text()); } catch { setMessage({ text: "That file could not be read as a guide export.", tone: "alert" }); return; }
    setPending(true);
    try {
      const result = await guideShareApi.preview(parsed);
      if (!result.ok) { setMessage({ text: "That file is not a guide export this portal can read.", tone: "alert" }); setOutcome(result); return; }
      setFile(parsed); setOutcome(result);
    } catch (error) { setMessage({ text: statusOf(error) === 401 || statusOf(error) === 403 ? NOT_ALLOWED : "The file could not be checked. Try again.", tone: "alert" }); }
    finally { setPending(false); }
  }
  async function confirm() {
    if (!file || pending || done) return;
    setPending(true); setMessage(null);
    try {
      const result = await guideShareApi.importFile(file);
      if (!result.ok) { setOutcome(result); setMessage({ text: "That file is not a guide export this portal can read.", tone: "alert" }); return; }
      setOutcome(result); setDone(true); setFile(null);
      setMessage({ text: "Import finished. Imported guides are held until you publish them.", tone: "status" });
      if (input.current) input.current.value = "";
    } catch (error) { setMessage({ text: statusOf(error) === 401 || statusOf(error) === 403 ? NOT_ALLOWED : "We couldn’t confirm the import. Check your guides before trying again.", tone: "alert" }); }
    finally { setPending(false); }
  }
  const ok = outcome?.ok ? outcome : null, ready = ok ? [...ok.guides, ...ok.summaries].filter(item => item.status === "ready").length : 0;
  return <section className="role-workspace admin-workspace settings-workspace">
    <PageHeader title="Share guides" />
    <section className="people-card" aria-labelledby="guide-share-export-head">
      <div className="people-card-head"><h2 id="guide-share-export-head">Export</h2>
        <p>Downloads one file with your reviewed guides, approved portion summaries and published discussions, each credited to its author. It never includes student guides, student or family details, held drafts or unreviewed work.</p></div>
      <p><a className="button" href={guideShareApi.exportHref} download="guide-export.json" data-testid="guide-share-export">Download reviewed guides</a></p>
    </section>
    <section className="people-card" aria-labelledby="guide-share-import-head">
      <div className="people-card-head"><h2 id="guide-share-import-head">Import</h2>
        <p>Choose a file another congregation exported. You see what it holds before anything is saved. Imported guides stay held until you publish them, credited to the authors the file names. Nothing you already have is changed.</p></div>
      <div className="roster-field"><label htmlFor="guide-share-file">Guide export file</label>
        <input id="guide-share-file" ref={input} type="file" accept="application/json,.json" disabled={pending} onChange={event => void choose(event)} data-testid="guide-share-file" />
        {name && <p className="field-help">{name}</p>}</div>
    </section>
    {message && <p className={message.tone === "alert" ? "request-error roster-message" : "workspace-notice roster-message"} role={message.tone} data-testid="guide-share-message">{message.text}</p>}
    {outcome && !outcome.ok && outcome.problems.length > 0 && <ul data-testid="guide-share-problems">{outcome.problems.map(problem => <li key={problem}>{problem}</li>)}</ul>}
    {ok && <>
      {ok.authors.length > 0 && <p data-testid="guide-share-authors">From {ok.authors.join(", ")}.</p>}
      <Group id="guides" title="Guides" items={ok.guides} />
      <Group id="summaries" title="Portion summaries" items={ok.summaries} />
      <Group id="discussions" title="Discussions" items={ok.discussions} />
      {ok.imported && <p data-testid="guide-share-result">{ok.imported.guides} guide{ok.imported.guides === 1 ? "" : "s"} and {ok.imported.summaries} summar{ok.imported.summaries === 1 ? "y" : "ies"} imported.</p>}
      {!done && <div className="form-actions settings-actions">
        <Button variant="primary" disabled={pending || ready === 0} onClick={() => void confirm()} data-testid="guide-share-confirm">{pending ? "Working…" : "Import into this portal"}</Button></div>}
      {done && <p><WorkspaceLink href="/workspace/more">Back to More</WorkspaceLink></p>}
    </>}
  </section>;
}
