"use client";
import { useEffect, useState } from "react";
import { APPROVED, PLAN } from "../../../lib/offline/copy";
import { purgeOffline, savedPacks } from "../../../lib/offline/pack-index";
import { WINDOW_MS, type Pack } from "../../../lib/offline/policy";
import { readAddress } from "../public-reading/urls";
import { COPY as SERVICE_COPY } from "../../../lib/service-course/copy";
import { savedDate, useOfflinePacks, useOnline, usePlatform, useProductName } from "./status";
import styles from "./offline.module.css";

/**
 * /offline: what this device keeps, each with an Open link to the same address the reader or the course uses,
 * how long it lasts, and Remove (for a shared device). It is also the installed app's page for any address
 * that needs a connection.
 *
 * A2: the person's own readings open at their /read?ref= address (the public ref routes they were packed from),
 * named as My readings names them: a member's own name for the reading, else "Torah" or "Haftarah" and the range.
 * Online, they show only once this page load has asked whose readings this device keeps, so an account that
 * replaced another on this device never sees the other's list.
 *
 * 1.9 N24 (D20): the page is never empty. Its heading always renders (the server render too, so the shell copy has it),
 * and on a host that keeps nothing (a preview or an alias) it says the approved "Nothing is saved on this device yet."
 */
const displayRange = (ranges: string) => ranges.replace(/(\d)-(\d)/g, "$1–$2");
// The evening lessons' text (2.0 SC7, signed-in CRC people only) opens the service course and is named by the course's own title.
const target = (pack: Pack) => pack.descriptor.type === "week" ? "/read" : pack.descriptor.type === "ref" ? readAddress({ mode: "ref", ref: pack.descriptor.ref, kind: pack.descriptor.kind })
  : pack.descriptor.type === "evening" ? "/learn/service" : "/learn";
const label = (pack: Pack) => pack.descriptor.type === "course" ? APPROVED.courseLabel : pack.descriptor.type === "evening" ? SERVICE_COPY.home.title
  : pack.descriptor.type === "ref" ? pack.label || `${pack.descriptor.kind === "torah" ? "Torah" : "Haftarah"} ${displayRange(pack.descriptor.ref)}`
    : pack.label && pack.label !== "week" ? pack.label : APPROVED.weekLabel;

export function OfflineShelf() {
  const platform = usePlatform(), live = platform?.origin === true;
  const [packs, setPacks] = useState<readonly Pack[] | null>(null), [removed, setRemoved] = useState(false), productName = useProductName(live);
  const { ownerChecked, week, course } = useOfflinePacks(), online = useOnline(), showOwn = ownerChecked || !online;
  useEffect(() => {
    if (!live) return; let current = true;
    void savedPacks().then(rows => { if (current) setPacks(showOwn ? rows : rows.filter(pack => pack.owner === "public")); });
    return () => { current = false; };
  }, [live, showOwn, week, course]);
  return <OfflineShelfView live={platform === null ? null : live} packs={packs} removed={removed} productName={productName}
    onRemove={() => void purgeOffline().then(() => { setRemoved(true); setPacks([]); })} />;
}

/**
 * What /offline draws. `live`: null before the platform is known (the server render, and so the shell copy), false on a host
 * that keeps nothing, true on an offline origin. The heading is always there; the empty line shows wherever nothing is saved.
 */
export function OfflineShelfView(props: Readonly<{ live: boolean | null; packs: readonly Pack[] | null; removed: boolean; productName: string | null; onRemove(): void }>) {
  const { live, packs, removed, productName } = props;
  const empty = <p className={styles.shelfEmpty} role="status" data-testid="offline-empty">{removed ? APPROVED.removed : APPROVED.nothingSaved}</p>;
  return <div className="portal-shell">
    <a className="skip-link" href="#offline-main">Skip to main content</a>
    <header className="portal-header app-bar"><a className="portal-brand" href="/">{productName ?? "CRC Torah"}</a></header>
    <main id="offline-main" className={styles.shelfMain}>
      <h1 className={styles.shelfTitle}>{PLAN.saved}</h1>
      {live === false && empty}
      {live === true && <>
      {packs !== null && (packs.length ? <ul className={styles.shelf}>{packs.map(pack => <li key={pack.key}>
        <span className={styles.shelfLabel}><bdi dir="auto">{label(pack)}</bdi></span>
        <span className={styles.shelfDate}>{APPROVED.savedUntil(savedDate(Math.min(pack.expiresAt, pack.renewedAt + WINDOW_MS)))}</span>
        <a className="button-secondary" href={target(pack)}>{PLAN.open}</a>
      </li>)}</ul> : empty)}
      {productName && <p className="field-help">{PLAN.expiry(productName)}</p>}
      {packs !== null && packs.length > 0 && <button type="button" className="button-secondary" onClick={props.onRemove}>{PLAN.remove}</button>}</>}
    </main>
  </div>;
}
