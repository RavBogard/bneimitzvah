import { useId } from "react";
import type { HonoreeOwner, HonoreeState } from "./honoree-owner";
import styles from "./honors.module.css";

const date = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
export function HonoreeControls({ startVerse, owner, state, blocked }: { startVerse: string; owner: HonoreeOwner; state: HonoreeState; blocked: boolean }) {
  const id = useId(), record = state.records[startVerse], confirmation = state.confirmation?.startVerse === startVerse ? state.confirmation : null, secret = state.secret?.startVerse === startVerse ? state.secret : null;
  const locked = blocked || owner.busy() || owner.uncertain(), issueReady = owner.canIssue(startVerse);
  return <div className={styles.honoree} aria-labelledby={id}>
    <h4 id={id}>Blessing link</h4><p className={styles.help}>For the people on this aliyah only. Nothing is sent: you copy the link and share it yourself. The full link is shown once, right after it’s created.</p>
    {!issueReady && <p className={styles.help}>Save the names, and review any ceremony or reading change, before creating a link.</p>}
    {record && <p className={styles.help}>A current link is recorded{record.issuedAt ? `, created ${date(record.issuedAt)}` : ""}{record.expiresAt ? `, with a recorded expiry of ${date(record.expiresAt)}` : ""}. Its full address isn’t kept, so it can’t be shown again; replace it to get a new one. This record doesn’t confirm the link opens or that the blessings are ready.</p>}
    {owner.known(startVerse) && record === null && <p className={styles.help}>No current link is recorded for this aliyah.</p>}
    <div className={styles.actions}>
      <button type="button" className="button-secondary" disabled={locked} onClick={() => void owner.status(startVerse)}>Check link</button>
      {!record && <button type="button" className="button-secondary" disabled={locked || !issueReady || !owner.known(startVerse)} onClick={() => void owner.issue(startVerse)}>Create blessing link</button>}
      {record && <><button type="button" className="button-secondary" disabled={locked || !issueReady} onClick={() => owner.confirm("reissue", startVerse)}>Replace link…</button><button type="button" className="button-text" disabled={locked || !owner.canRevoke(startVerse)} onClick={() => owner.confirm("revoke", startVerse)}>Revoke link…</button></>}
    </div>
    {confirmation && <div className={styles.notice}><p>{confirmation.operation === "reissue" ? "Replace this link? The old link will stop working. Copy the new one when it appears; it can’t be shown again later." : "Revoke this link? The link will stop working for anyone who has it."}</p><div className={styles.actions}><button type="button" className="button-secondary" disabled={locked} onClick={() => owner.cancelConfirmation()}>Keep current link</button><button type="button" className="button-primary" disabled={locked} onClick={() => void owner.acceptConfirmation()}>{confirmation.operation === "reissue" ? "Replace recorded link" : "Revoke recorded link"}</button></div></div>}
    {state.pending?.startVerse === startVerse && state.phase === "unknown" && <div className={styles.notice}><p>We couldn’t confirm whether this link change saved. It may have. Check what saved before doing anything else; closing this sheet can’t undo it.</p><div className={styles.actions}><button type="button" className="button-primary" disabled={blocked || owner.busy()} onClick={() => void owner.check()}>Check what saved</button><button type="button" className="button-text" disabled={blocked || owner.busy()} onClick={() => void owner.retry()}>Send the same request again</button></div></div>}
    {secret && <div className={styles.linkSecret}><label htmlFor={`${id}-url`}>New blessing link · copy it now</label><input id={`${id}-url`} data-honoree-secret type="text" readOnly value={secret.url} autoComplete="off" spellCheck={false} dir="ltr" /><button type="button" className="button-secondary" disabled={locked} onClick={() => void owner.copy(value => navigator.clipboard.writeText(value))}>{state.copied ? "Copied" : "Copy link"}</button><p className={styles.help}>This is the only time the full link is shown. Nothing was sent; share it with the person yourself.</p></div>}
    {state.scope === startVerse && <p role="status" className={styles.help}>{owner.busy() ? state.phase === "status" ? "Checking the link record…" : "Confirming the link action…" : state.message}</p>}
  </div>;
}
