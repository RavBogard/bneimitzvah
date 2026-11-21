import type { DayProof } from "../offline/practice-lease";
import { chicagoDate, PRACTICE_DATE_BATCH, PRACTICE_REPLAY_DAYS, practiceDateOrdinal } from "./day";

const ENDPOINT = "/api/learn/practice-days";
export const PRACTICE_DATE_PREFIX = "crc-torah:practice-date/v1:";
const OWNER = /^[a-f0-9]{32}$/;
type PracticeDateStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
type Binding = DayProof;

function binding(value: unknown): Binding | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return row.ok === true && typeof row.owner === "string" && OWNER.test(row.owner) && Number.isSafeInteger(row.expiresAt)
    ? { owner: row.owner, expiresAt: row.expiresAt as number,
      ...(typeof row.offlineOwner === "string" && /^[A-Za-z0-9_-]{43}$/.test(row.offlineOwner) ? { offlineOwner: row.offlineOwner } : {}) } : null;
}

function acknowledged(value: unknown, sent: string[]): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const row = value as Record<string, unknown>;
  if (row.ok !== true || !Array.isArray(row.accepted) || !Array.isArray(row.discarded)) return [];
  const dates = [...row.accepted, ...row.discarded];
  return dates.length === sent.length && new Set(dates).size === dates.length && dates.every(date => typeof date === "string" && sent.includes(date)) ? dates as string[] : [];
}

export function hasPracticeDates(storage: PracticeDateStorage | null): boolean {
  try {
    if (storage) for (let i = 0; i < storage.length; i++) if (storage.key(i)?.startsWith(PRACTICE_DATE_PREFIX)) return true;
  } catch { /* No browser storage. */ }
  return false;
}

export function createPracticeDateQueue(io: { fetch: typeof fetch; storage(): PracticeDateStorage | null; now?: () => number; onBinding?(proof: DayProof): void }) {
  const now = io.now ?? Date.now;
  let proof: Binding | null = null, boundOwner: string | null = null, blocked = false, pending: Promise<Binding | null> | null = null;
  let flushing: Promise<void> | null = null, repeat = false;
  const memory = new Set<string>();
  const prefix = (owner: string) => PRACTICE_DATE_PREFIX + owner + ":";
  const live = (value: Binding | null): value is Binding => !blocked && value !== null && value.expiresAt > now();

  async function authenticate() {
    try {
      const response = await io.fetch(ENDPOINT, { cache: "no-store", credentials: "same-origin", redirect: "error" });
      if ([401, 403, 404].includes(response.status)) { blocked = true; return null; }
      if (!response.ok) return null;
      const next = binding(await response.json());
      if (!next || next.expiresAt <= now()) return null;
      if (boundOwner && boundOwner !== next.owner) { blocked = true; return null; }
      boundOwner = next.owner; proof = next; blocked = false;
      io.onBinding?.(next);
      return next;
    } catch { return null; }
  }

  const check = () => pending ??= authenticate().finally(() => { pending = null; });
  function remove(key: string) {
    memory.delete(key);
    try { io.storage()?.removeItem(key); } catch { /* Retry by idempotent insert on the next sync. */ }
  }
  function dates(owner: string) {
    const stem = prefix(owner), stored = new Set([...memory].filter(key => key.startsWith(stem)));
    try {
      const storage = io.storage();
      if (storage) {
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (key?.startsWith(stem) && storage.getItem(key) === "1") stored.add(key);
        }
      }
    } catch { /* Still send any in-memory dates. */ }
    const current = practiceDateOrdinal(chicagoDate(now()).date)!;
    return [...stored].flatMap(key => {
      const date = key.slice(stem.length), ordinal = practiceDateOrdinal(date);
      if (ordinal === null || current - ordinal > PRACTICE_REPLAY_DAYS + 1) { remove(key); return []; }
      return [date];
    }).sort();
  }

  async function send() {
    if (!live(proof)) return;
    const owner = proof.owner;
    let batch = dates(owner);
    while (batch.length && live(proof)) {
      const sent = batch.slice(0, PRACTICE_DATE_BATCH);
      try {
        const response = await io.fetch(ENDPOINT, { method: "POST", cache: "no-store", credentials: "same-origin", redirect: "error",
          headers: { "content-type": "application/json" }, keepalive: true, body: JSON.stringify({ owner, dates: sent }) });
        if ([401, 403, 404].includes(response.status)) blocked = true;
        if (!response.ok) return;
        const settled = acknowledged(await response.json(), sent);
        if (!settled.length) return;
        for (const date of settled) remove(prefix(owner) + date);
        batch = batch.slice(sent.length);
      } catch { return; }
    }
  }

  const flush = () => {
    if (flushing) { repeat = true; return flushing; }
    return flushing = (async () => {
      do { repeat = false; await send(); } while (repeat);
    })().finally(() => { flushing = null; });
  };
  const store = (owner: string, instant: number) => {
    const key = prefix(owner) + chicagoDate(instant).date;
    memory.add(key);
    try { io.storage()?.setItem(key, "1"); } catch { /* This tab can still retry from memory. */ }
  };
  const queue = (value: Binding, instant: number) => {
    if (!live(value) || value.expiresAt <= instant) return;
    store(value.owner, instant);
    void flush();
  };
  return Object.freeze({
    async verifyAndReplay() { if (await check()) await flush(); },
    async completeOnline(instant = now()) {
      const verified = await (boundOwner ? check() : pending);
      if (verified) queue(verified, instant);
    },
    complete(instant = now()) {
      if (!pending && live(proof)) { queue(proof, instant); return true; }
      return false;
    },
    pinOffline(lease: Binding) {
      if (lease.expiresAt <= now()) return;
      if (boundOwner && boundOwner !== lease.owner) blocked = true;
      boundOwner = lease.owner;
    },
    completeOffline(lease: Binding, instant = now()) {
      const retain = () => {
        if (live(lease) && lease.expiresAt > instant && boundOwner === lease.owner) store(lease.owner, instant);
      };
      if (pending) void pending.then(retain);
      else retain();
    },
  });
}
