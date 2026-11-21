import { OFFLINE_CACHE, PRACTICE_LEASE_KEY, type PackDescriptor, packLive } from "./policy";
import { purgeGeneration, readIndex, readPracticeLeaseRecord, type PracticeLeaseRecord } from "./pack-index";

const CHILD_LEASE_KEY = "crc-torah:child-practice-lease/v1";
const CHILD_HISTORY_KEY = "crcChildPracticeTab";
const TAB = /^[a-f0-9-]{36}$/;
const childRecord = () => JSON.parse(sessionStorage.getItem(CHILD_LEASE_KEY) ?? "null") as Record<string, unknown> | null;
const historyMatches = (record: Record<string, unknown> | null) => typeof record?.tab === "string" && TAB.test(record.tab) && history.state?.[CHILD_HISTORY_KEY] === record.tab;

export function stampChildPracticeHistory(partition: string) {
  try {
    const record = childRecord();
    if (record?.partition === partition && typeof record?.tab === "string" && TAB.test(record.tab)) {
      history.replaceState({ ...history.state, [CHILD_HISTORY_KEY]: record.tab }, "");
    }
  } catch { /* No saved child lease to carry. */ }
}

/** The next entry belongs to the same tab. A new tab gets no matching history marker. */
export function continueOfflineChildPractice(href: string): boolean {
  try {
    const record = childRecord();
    if (!historyMatches(record)) return false;
    history.pushState({ ...history.state, [CHILD_HISTORY_KEY]: record!.tab }, "", href);
    location.reload();
    return true;
  } catch { return false; }
}
const PARTITION = /^crc-torah:child-learning\/v1:[a-f0-9]{64}:$/;
export type DayProof = Readonly<{ owner: string; expiresAt: number; offlineOwner?: string }>;
export type PracticeLease = Readonly<{ owner: string; expiresAt: number; generation: number; partition?: string }>;
const cacheStorage = () => { try { return typeof caches === "undefined" ? null : caches; } catch { return null; } };
export const childPracticePartition = async (studentId: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(studentId));
  const key = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  return `crc-torah:child-learning/v1:${key}:`;
};

export async function savePracticeLease(proof: DayProof, generation: number, childPartition?: string, now = Date.now(), storage = cacheStorage(), current = () => true) {
  if (!proof.offlineOwner || !storage || proof.expiresAt <= now || generation !== purgeGeneration()) return;
  try {
    if (!await storage.has(OFFLINE_CACHE)) return;
    const cache = await storage.open(OFFLINE_CACHE), index = await readIndex(cache);
    if (index.owner !== proof.offlineOwner || generation !== purgeGeneration() || !current()) return;
    const lease: PracticeLeaseRecord = { owner: proof.owner, offlineOwner: proof.offlineOwner, savedAt: now, expiresAt: proof.expiresAt };
    if (childPartition) {
      if (!PARTITION.test(childPartition)) return;
      const previous = childRecord();
      const tab = previous?.partition === childPartition && typeof previous?.tab === "string" && TAB.test(previous.tab) ? previous.tab : crypto.randomUUID();
      sessionStorage.setItem(CHILD_LEASE_KEY, JSON.stringify({ ...lease, partition: childPartition, tab }));
      stampChildPracticeHistory(childPartition);
    } else {
      await cache.put(PRACTICE_LEASE_KEY, Response.json(lease));
      if (generation !== purgeGeneration() || (await readIndex(cache)).owner !== proof.offlineOwner) await cache.delete(PRACTICE_LEASE_KEY);
    }
  } catch { /* A missing lease leaves this activity's day unbound while offline. */ }
}

export function forgetChildPracticeLease() {
  try { sessionStorage.removeItem(CHILD_LEASE_KEY); } catch { /* Unavailable storage contains no usable selection. */ }
}

export async function readPracticeLease(kind: "direct" | "child", savedFor: PackDescriptor["type"], now = Date.now(), storage = cacheStorage()): Promise<PracticeLease | null> {
  if (!storage) return null;
  const generation = purgeGeneration();
  try {
    if (!await storage.has(OFFLINE_CACHE)) return null;
    const cache = await storage.open(OFFLINE_CACHE), index = await readIndex(cache);
    if (!index.owner || !index.packs.some(pack => pack.descriptor.type === savedFor && packLive(pack, now)
      && (pack.owner === "public" || pack.owner === index.owner))) return null;
    const value = kind === "child" ? childRecord() : await (await cache.match(PRACTICE_LEASE_KEY))?.json();
    const lease = readPracticeLeaseRecord(value, index.owner, now);
    const partition = kind === "child" && typeof value?.partition === "string" && PARTITION.test(value.partition) ? value.partition as string : undefined;
    if (!lease || generation !== purgeGeneration() || kind === "child" && (!partition || !historyMatches(value))) return null;
    return { owner: lease.owner, expiresAt: lease.expiresAt, generation, partition };
  } catch { return null; }
}
