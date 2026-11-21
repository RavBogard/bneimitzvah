"use client";
import { useEffect, useState } from "react";
import { savedPacks, packingIdle, inspectPack, offlineState } from "../../../lib/offline/pack-index";
import { OFFLINE_CACHE, type Pack } from "../../../lib/offline/policy";
import { readAddress } from "../public-reading/urls";
import { canonicalReadingRef } from "../../../lib/readings/reading-ref";
import type { Reading } from "../workspace/api";
import { saveOfflinePacks } from "./runtime";
import { savedDate, useOfflinePacks, useOnline, usePlatform } from "./status";

/** No assignment, learner name, private note or session is stored here. The owner-checked packer selects permitted public assets. */
export function AssignedPracticeOffline({ reading, onOpen }: { reading: Reading; onOpen?(): void }) {
  const platform = usePlatform(), online = useOnline(), state = useOfflinePacks();
  const [pack, setPack] = useState<Pack | null>(null), [complete, setComplete] = useState(false), [saving, setSaving] = useState(false), [checked, setChecked] = useState(false);
  const ref = canonicalReadingRef(reading.ranges.join("; "), reading.kind)?.ref ?? null;
  const key = `${reading.kind}:${ref}`;
  const inspect = async (current: () => boolean = () => true) => {
    const rows = await savedPacks(), owner = offlineState();
    // An unchecked owner never gets another account's saved state or link.
    const saved = owner.ownerChecked && owner.ownerKey ? rows.find(row => row.owner === owner.ownerKey && row.descriptor.type === "ref" && row.descriptor.kind === reading.kind && row.descriptor.ref === ref) : undefined;
    const status = saved ? await inspectPack(await caches.open(OFFLINE_CACHE), saved, Date.now()) : null;
    if (current()) { setPack(saved ?? null); setComplete(status === "saved"); }
  };
  useEffect(() => {
    let current = true;
    void packingIdle().then(() => inspect(() => current)).catch(() => { if (current) { setPack(null); setComplete(false); } });
    return () => { current = false; };
  }, [key, state.ownerChecked, state.ownerKey, state.week, state.course, state.service]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ref || !platform?.origin) return null;
  const save = async () => {
    setSaving(true); setChecked(false);
    try { await saveOfflinePacks(); await inspect(); setChecked(true); } catch { setPack(null); setComplete(false); setChecked(true); } finally { setSaving(false); }
  };
  return <section className="assigned-offline" aria-label="Practice offline" data-testid="assigned-practice-offline">
    <h2>Practice offline</h2>
    {!platform.installed ? <p>Install the app to save this passage on this device. <a href="/account">See installation steps</a>.</p> : <>
      <p role="status">{saving ? "Saving the passage and available recordings…" : complete ? `Saved on this device until ${savedDate(pack!.expiresAt)}.` : pack ? "Part of this passage is saved. A connection is needed for the rest." : checked ? "This passage isn’t saved yet. Check your connection and try again." : "Save this passage before going offline."}</p>
      <button type="button" className="button-secondary" disabled={saving || !online} onClick={() => void save()}>{saving ? "Saving…" : complete ? "Update saved passage" : "Save for offline practice"}</button>
      {pack && <p><a className="button-text" data-testid="open-offline-passage" onClick={onOpen} href={readAddress({ mode: "ref", kind: reading.kind, ref })}>Open saved passage</a></p>}
      <p className="field-help">The saved passage includes the text and available public recordings. Lesson notes and progress need a connection.</p>
    </>}
  </section>;
}
