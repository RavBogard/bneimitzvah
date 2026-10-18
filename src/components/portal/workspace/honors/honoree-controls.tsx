import { useId } from "react";
import type { HonoreeOwner, HonoreeState } from "./honoree-owner";
import styles from "./honors.module.css";

const date = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
export function HonoreeControls({ startVerse, owner, state, blocked }: { startVerse: string; owner: HonoreeOwner; state: HonoreeState; blocked: boolean }) {
  const id = useId(), record = state.records[startVerse], confirmation = state.confirmation?.startVerse === startVerse ? state.confirmation : null, secret = state.secret?.startVerse === startVerse ? state.secret : null;
  const locked = blocked || owner.busy() || owner.uncertain(), issueReady = owner.canIssue(startVerse);
  return <div className={styles.honoree} aria-labelledby={id}>
    <h4 id={id}>Blessing link</h4><p className={styles.help}>For this aliyah only. Creating a link does not send an invitation.</p>
    {!issueReady && <p className={styles.help}>To create or replace a link, save the names and review the current ceremony, reading and aliyah divisions first.</p>}
    {record && <p className={styles.help}>A non-revoked link record is stored{record.issuedAt ? ` (created ${date(record.issuedAt)})` : ""}{record.expiresAt ? `, with a recorded expiry of ${date(record.expiresAt)}` : ""}. This does not confirm that the link is usable.</p>}
    {owner.known(startVerse) && record === null && <p className={styles.help}>No current link record was found.</p>}
    <div className={styles.actions}>
      <button type="button" className="button-secondary" disabled={locked} onClick={() => void owner.status(startVerse)}>Check link record</button>
      {!record && <button type="button" className="button-secondary" disabled={locked || !issueReady || !owner.known(startVerse)} onClick={() => void owner.issue(startVerse)}>Create blessing link</button>}
      {record && <><button type="button" className="button-secondary" disabled={locked || !issueReady} onClick={() => owner.confirm("reissue", startVerse)}>Replace link…</button><button type="button" className="button-text" disabled={locked || !owner.canRevoke(startVerse)} onClick={() => owner.confirm("revoke", startVerse)}>Revoke link…</button></>}
    </div>
    {confirmation && <div className={styles.notice}><p>{confirmation.operation === "reissue" ? "Replace this link? The previous credential will stop working. Copy the new URL when it appears; it cannot be recovered later." : "Revoke this link? Anyone using the recorded credential will lose access."}</p><div className={styles.actions}><button type="button" className="button-secondary" disabled={locked} onClick={() => owner.cancelConfirmation()}>Keep current link</button><button type="button" className="button-primary" disabled={locked} onClick={() => void owner.acceptConfirmation()}>{confirmation.operation === "reissue" ? "Replace recorded link" : "Revoke recorded link"}</button></div></div>}
    {state.pending?.startVerse === startVerse && state.phase === "unknown" && <div className={styles.notice}><p>The original link action is unconfirmed. Clearing this sheet cannot undo an action that may have committed.</p><div className={styles.actions}><button type="button" className="button-secondary" disabled={blocked || owner.busy()} onClick={() => void owner.check()}>Check original receipt</button><button type="button" className="button-secondary" disabled={blocked || owner.busy()} onClick={() => void owner.retry()}>Retry same action</button></div></div>}
    {secret && <div className={styles.linkSecret}><label htmlFor={`${id}-url`}>New blessing link · copy now</label><input id={`${id}-url`} data-honoree-secret type="text" readOnly value={secret.url} autoComplete="off" spellCheck={false} dir="ltr" /><button type="button" className="button-secondary" disabled={locked} onClick={() => void owner.copy(value => navigator.clipboard.writeText(value))}>{state.copied ? "Copied" : "Copy link"}</button><p className={styles.help}>Full URLs are not kept in link records or receipts. No invitation was sent.</p></div>}
    {state.scope === startVerse && <p role="status" className={styles.help}>{owner.busy() ? state.phase === "status" ? "Checking the link record…" : "Confirming the link action…" : state.message}</p>}
  </div>;
}
