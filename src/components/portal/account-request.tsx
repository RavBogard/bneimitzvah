"use client";
import { useEffect, useId, useRef, useState } from "react";

/**
 * Asking to be linked (readings for everyone, plan D6; was "Ask for an account", release 1.4 plan section 5). Everyone who signs in
 * already has a shelf; this asks the rabbi to connect the account to a student record. A request waits for an approver and ends
 * in one email. The "member" state (an approved Member role) shows nothing: there is nothing left to ask for here.
 */
export type RequestState = "requestable" | "pending" | "member";
export type RequestView = Readonly<{ status: "loading" } | { status: "failed" } | { status: "ready"; state: RequestState; suggestedName: string; productName: string }>;
type Problem = null | "invalid" | "rate-limited" | "busy" | "unavailable";
const CONTROLS = /[\x00-\x1f\x7f-\x9f\u00ad\u061c\u115f\u1160\u200b-\u200d\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\u3164\ufeff\uffa0\u{e0000}-\u{e007f}]/u;
const problems: Record<Exclude<Problem, null>, string> = {
  invalid: "Use a name of 1 to 80 characters, and up to 500 for who you are.",
  "rate-limited": "You’ve asked several times today. Try again tomorrow.",
  busy: "Many requests are waiting right now. Try again later.",
  unavailable: "The request didn’t send. Try again.",
};

async function call(body?: Record<string, unknown>): Promise<{ status: number; value: unknown }> {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch("/api/account/request", { method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", signal: controller.signal,
      headers: body ? { accept: "application/json", "content-type": "application/json" } : { accept: "application/json" }, body: body ? JSON.stringify(body) : undefined });
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return { status: 503, value: null };
    const raw = await response.text(); if (raw.length > 16 * 1024) return { status: 503, value: null };
    return { status: response.status, value: JSON.parse(raw) };
  } catch { return { status: 503, value: null }; }
  finally { clearTimeout(timeout); }
}
const keys = (value: unknown, list: readonly string[]): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === list.length && list.every(key => Object.hasOwn(value, key)) ? value as Record<string, unknown> : null;
const stateOf = (value: unknown): RequestState | null => value === "requestable" || value === "pending" || value === "member" ? value : null;
export function parseRequestView(status: number, value: unknown): RequestView {
  const row = status === 200 ? keys(value, ["ok", "state", "suggestedName", "productName"]) : null, state = stateOf(row?.state);
  if (!row || row.ok !== true || !state || typeof row.suggestedName !== "string" || Array.from(row.suggestedName).length > 80 || CONTROLS.test(row.suggestedName)) return { status: "failed" };
  // The congregation's product name: the same bounds as the mail transport and the add-congregation script.
  if (typeof row.productName !== "string" || !row.productName || row.productName.trim() !== row.productName || Array.from(row.productName).length > 120 || CONTROLS.test(row.productName)) return { status: "failed" };
  return { status: "ready", state, suggestedName: row.suggestedName, productName: row.productName };
}
export function parseRequestResult(status: number, value: unknown): "pending" | "member" | Exclude<Problem, null> {
  if (status === 429) { const row = keys(value, ["ok", "code"]); return row?.code === "rate-limited" ? "rate-limited" : "busy"; }
  if (status === 400) return "invalid";
  const row = status === 200 ? keys(value, ["ok", "state"]) : null, state = stateOf(row?.state);
  return row?.ok === true && (state === "pending" || state === "member") ? state : "unavailable";
}

/** The request in each of its states; pure, for tests. `level` keeps the heading in its page's outline. */
export function AccountRequestView({ view, level, name, purpose, problem, sending, formId, onName, onPurpose, onSubmit, onRetry }: {
  view: RequestView; level: 3 | 4; name: string; purpose: string; problem: Problem; sending: boolean; formId: string;
  onName(value: string): void; onPurpose(value: string): void; onSubmit(): void; onRetry(): void;
}) {
  const Heading = level === 3 ? "h3" : "h4";
  if (view.status === "loading") return <div className="account-request" aria-busy="true"><p role="status">Checking your account…</p></div>;
  if (view.status === "failed") return <div className="account-request"><p role="status">Account requests aren’t available right now.</p><button type="button" className="button-secondary" onClick={onRetry}>Try again</button></div>;
  // Readings for everyone (plan D6): an approved Member role leaves nothing to ask for here; the shelf is everyone's already.
  if (view.state === "member") return null;
  if (view.state === "pending") return <div className="account-request" data-request-state="pending"><Heading>Your request is in</Heading>
    <p role="status">You’ll get one email when it’s been linked.</p></div>;
  return <div className="account-request" data-request-state="requestable"><Heading id={`${formId}-title`}>Ask to be linked</Heading>
    <p>Preparing a Beit Mitzvah at CRC? Ask the rabbi to connect this account to your student record.</p>
    <form aria-labelledby={`${formId}-title`} onSubmit={event => { event.preventDefault(); onSubmit(); }}>
      <label htmlFor={`${formId}-name`}>Your name</label>
      <input id={`${formId}-name`} name="name" value={name} maxLength={80} required autoComplete="name" disabled={sending} onChange={event => onName(event.target.value)} />
      <label htmlFor={`${formId}-purpose`}>Who you are (the student’s name and ceremony date, or whose parent you are)</label>
      <textarea id={`${formId}-purpose`} name="purpose" value={purpose} maxLength={500} rows={3} disabled={sending} onChange={event => onPurpose(event.target.value)} />
      {problem && <p className="request-error" role="alert">{problems[problem]}</p>}
      <button type="submit" className="button-primary" disabled={sending}>{sending ? "Sending request…" : "Send request"}</button>
    </form></div>;
}

/** The live request for the signed-in account. */
export function AccountRequest({ level }: { level: 3 | 4 }) {
  const [view, setView] = useState<RequestView>({ status: "loading" }), [retry, setRetry] = useState(0);
  const [name, setName] = useState(""), [purpose, setPurpose] = useState(""), [problem, setProblem] = useState<Problem>(null), [sending, setSending] = useState(false);
  const formId = useId(), alive = useRef(true), gate = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    let current = true;
    setView({ status: "loading" });
    void call().then(({ status, value }) => { if (!current) return; const next = parseRequestView(status, value); setView(next); if (next.status === "ready") setName(value => value || next.suggestedName); });
    return () => { current = false; };
  }, [retry]);
  const submit = async () => {
    if (gate.current) return;
    const trimmed = name.trim(), aim = purpose.replace(/\r\n?|\n/g, " ").trim();
    if (!trimmed || Array.from(trimmed).length > 80 || CONTROLS.test(trimmed) || Array.from(aim).length > 500 || CONTROLS.test(aim)) { setProblem("invalid"); return; }
    gate.current = true; setSending(true); setProblem(null);
    try {
      const { status, value } = await call(aim ? { name: trimmed, purpose: aim } : { name: trimmed });
      if (!alive.current) return;
      const result = parseRequestResult(status, value);
      if (result === "pending" || result === "member") setView(prior => prior.status === "ready" ? { ...prior, state: result, suggestedName: trimmed } : prior); else setProblem(result);
    } finally { gate.current = false; if (alive.current) setSending(false); }
  };
  return <AccountRequestView view={view} level={level} name={name} purpose={purpose} problem={problem} sending={sending} formId={formId}
    onName={setName} onPurpose={setPurpose} onSubmit={() => void submit()} onRetry={() => setRetry(value => value + 1)} />;
}
