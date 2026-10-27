"use client";

import { useEffect, useState } from "react";
import type { StudyKind } from "./api";
import styles from "./guide.module.css";

type Summary = { version: number; origin: "claude" | "rabbi"; reviewed: boolean; hold: boolean; themes: number; updatedAt: string };
type Status = { kind: StudyKind; readingKey: string; rabbiName: string; visible: Summary | null; held: Summary | null };

function summary(value: unknown): Summary | null {
  if (value === null) return null;
  const row = value as Record<string, unknown>;
  if (!row || typeof row !== "object" || !Number.isSafeInteger(row.version) || (row.origin !== "claude" && row.origin !== "rabbi") || typeof row.reviewed !== "boolean"
    || typeof row.hold !== "boolean" || !Number.isSafeInteger(row.themes) || typeof row.updatedAt !== "string" || !Number.isFinite(Date.parse(row.updatedAt))) throw new Error("bad status");
  return { version: row.version as number, origin: row.origin, reviewed: row.reviewed, hold: row.hold, themes: row.themes as number, updatedAt: row.updatedAt };
}
async function readStatus(kind: StudyKind, readingKey: string, signal: AbortSignal): Promise<Status> {
  const response = await fetch(`/api/admin/study-guides/${kind}/${encodeURIComponent(readingKey)}`, { headers: { accept: "application/json" }, credentials: "same-origin", redirect: "error", cache: "no-store", referrerPolicy: "same-origin", signal });
  if (!response.ok || !response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new Error("status unavailable");
  const body = await response.json() as { ok?: unknown; guide?: Record<string, unknown> }, guide = body.guide;
  if (body.ok !== true || !guide || guide.kind !== kind || guide.readingKey !== readingKey || typeof guide.rabbiName !== "string") throw new Error("bad status");
  return { kind, readingKey, rabbiName: guide.rabbiName, visible: summary(guide.visible), held: summary(guide.held) };
}
const day = (value: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(value));

/**
 * The rabbi's one-line status above the guide: who wrote what students see, whether it is reviewed,
 * and whether a newer draft is held for review. Editing happens in Cowork (S10); this only reports.
 */
export function GuideStatusLine({ kind, readingKey }: { kind: StudyKind; readingKey: string | null }) {
  const [state, setState] = useState<{ key: string; status?: Status; failed?: boolean }>({ key: "" }), key = `${kind}:${readingKey}`;
  useEffect(() => {
    if (!readingKey) return;
    const controller = new AbortController();
    readStatus(kind, readingKey, controller.signal).then(status => setState({ key, status }), () => { if (!controller.signal.aborted) setState({ key, failed: true }); });
    return () => controller.abort();
  }, [kind, readingKey, key]);
  if (!readingKey) return <p className={styles.status}>Study guide: this reading has no calendar key, so only per-student additions can apply.</p>;
  if (state.key !== key) return null;
  if (state.failed || !state.status) return <p className={styles.status}>Study guide status is unavailable right now.</p>;
  const { visible, held } = state.status;
  if (!visible && !held) return <p className={styles.status}>Study guide: none yet for this reading · draft it in Cowork</p>;
  const shown = visible ? `${visible.reviewed ? "Reviewed" : "Claude draft, not reviewed"} · ${visible.themes} ${visible.themes === 1 ? "theme" : "themes"} · updated ${day(visible.updatedAt)}` : "Nothing shown to students yet";
  return <p className={styles.status} data-guide-status={visible ? (visible.reviewed ? "reviewed" : "draft") : "none-shown"} data-guide-themes={visible?.themes} data-guide-held={held ? "true" : undefined}>Study guide: {shown}{held && <> · newer draft waiting (updated {day(held.updatedAt)})</>} · edit in Cowork</p>;
}
