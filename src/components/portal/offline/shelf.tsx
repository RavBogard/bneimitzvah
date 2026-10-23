"use client";
import { useEffect, useState } from "react";
import { NEW, PLAN } from "../../../lib/offline/copy";
import { purgeOffline, savedPacks } from "../../../lib/offline/pack-index";
import { WINDOW_MS, type Pack } from "../../../lib/offline/policy";
import { savedDate, useProductName } from "./status";
import styles from "./offline.module.css";

/**
 * /offline: what this device keeps, each with an Open link to the same address the reader or the course uses,
 * how long it lasts, and Remove (for a shared device). It is also the installed app's page for any address
 * that needs a connection.
 */
const target = (pack: Pack) => pack.descriptor.type === "week" ? "/read" : "/learn";
const label = (pack: Pack) => pack.descriptor.type === "course" ? NEW.courseLabel : pack.label && pack.label !== "week" ? pack.label : NEW.weekLabel;

export function OfflineShelf() {
  const [packs, setPacks] = useState<readonly Pack[] | null>(null), [removed, setRemoved] = useState(false), productName = useProductName();
  useEffect(() => { let live = true; void savedPacks().then(rows => { if (live) setPacks(rows); }); return () => { live = false; }; }, []);
  return <div className="portal-shell">
    <a className="skip-link" href="#offline-main">Skip to main content</a>
    <header className="portal-header app-bar"><a className="portal-brand" href="/">{productName ?? "CRC Torah"}</a></header>
    <main id="offline-main" className={styles.shelfMain}>
      <h1 className={styles.shelfTitle}>{PLAN.saved}</h1>
      {packs !== null && (packs.length ? <ul className={styles.shelf}>{packs.map(pack => <li key={pack.key}>
        <span className={styles.shelfLabel}><bdi dir="auto">{label(pack)}</bdi></span>
        <span className={styles.shelfDate}>{NEW.savedUntil(savedDate(Math.min(pack.expiresAt, pack.renewedAt + WINDOW_MS)))}</span>
        <a className="button-secondary" href={target(pack)}>{PLAN.open}</a>
      </li>)}</ul> : <p className={styles.shelfEmpty} role="status">{removed ? NEW.removed : NEW.nothingSaved}</p>)}
      {productName && <p className="field-help">{PLAN.expiry(productName)}</p>}
      {packs !== null && packs.length > 0 && <button type="button" className="button-secondary" onClick={() => void purgeOffline().then(() => { setRemoved(true); setPacks([]); })}>{PLAN.remove}</button>}
    </main>
  </div>;
}
