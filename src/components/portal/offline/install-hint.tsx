"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { PLAN } from "../../../lib/offline/copy";
import { dismissHint, hintDismissed } from "../../../lib/offline/platform";
import { installPrompt, promptInstall, subscribeInstallPrompt } from "./runtime";
import { usePlatform, useProductName } from "./status";
import styles from "./offline.module.css";

/**
 * The install hint (§3.9 with the 2026-10-23 popup ruling): on an offline origin (torah or beitmitzvah), not already installed.
 * - `front-door`: one quiet row under the doors, shown to anyone on a phone or tablet, signed in or not, until
 *   dismissed; once dismissed it stays dismissed. Never on a reading page, never a modal.
 * - `account`: always available from Account, on any device that can install from here.
 * iPhone and iPad get their own steps; Chromium gets an Install button from its deferred prompt, and Android
 * without one gets the Chrome menu sentence.
 */
export function InstallHint({ place }: { place: "front-door" | "account" }) {
  const platform = usePlatform(), prompt = useSyncExternalStore(subscribeInstallPrompt, installPrompt, () => null);
  const [dismissed, setDismissed] = useState(true), [installed, setInstalled] = useState(false);
  useEffect(() => { setDismissed(hintDismissed()); }, []);
  const eligible = platform !== null && platform.origin && !platform.installed && !installed && (place === "account" || (platform.handheld && !dismissed));
  const productName = useProductName(eligible);
  if (!eligible || !productName) return null;
  const device = platform.device;
  const action = device === "iphone" ? <p className={styles.steps}>{PLAN.iphoneSteps}</p>
    : device === "ipad" ? <p className={styles.steps}>{PLAN.ipadSteps}</p>
      : prompt ? <button type="button" className="button-secondary" onClick={() => void promptInstall().then(done => { if (done) setInstalled(true); })}>{PLAN.installButton(productName)}</button>
        : device === "android" ? <p className={styles.steps}>{PLAN.androidMenu}</p> : null;
  // A desktop browser with nothing to offer shows nothing: there is no approved instruction for it.
  if (!action) return null;
  return <section className={place === "front-door" ? styles.hintRow : styles.hintAccount} aria-label={PLAN.installButton(productName)} data-install-hint={place}>
    <p className={styles.hintText}>{PLAN.installHint(productName)}</p>
    <div className={styles.hintActions}>
      {action}
      {place === "front-door" && <button type="button" className="button-text" onClick={() => { dismissHint(); setDismissed(true); }}>{PLAN.notNow}</button>}
    </div>
  </section>;
}
