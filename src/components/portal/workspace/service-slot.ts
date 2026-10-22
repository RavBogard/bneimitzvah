import type { ServiceSettings } from "./settings/api";

const standard = { morning: "Morning service", havdalah: "Havdalah service" } as const;
const known = (slot: string | null | undefined): slot is "morning" | "havdalah" => slot === "morning" || slot === "havdalah";

/**
 * The family-facing name of a confirmed service: the congregation's own name when its settings give
 * one, otherwise "Morning service" / "Havdalah service". Nothing for an unconfirmed or missing slot.
 */
export function serviceSlotName(slot: string | null | undefined, services?: ServiceSettings): string | null {
  return known(slot) ? services?.[slot]?.label ?? standard[slot] : null;
}
/** Whether the name is the portal's standard wording rather than one the congregation chose. */
export function standardSlotName(slot: string | null | undefined, services?: ServiceSettings): boolean {
  return known(slot) && !services?.[slot]?.label;
}
/** "10:00 AM" from the congregation's start time ("10:00"), or nothing when none is set. No time is ever implied. */
export function serviceSlotTime(slot: string | null | undefined, services?: ServiceSettings): string | null {
  const start = known(slot) ? services?.[slot]?.start : undefined, match = start ? /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(start) : null;
  if (!match) return null;
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(Date.UTC(1970, 0, 1, Number(match[1]), Number(match[2])));
}
/** The name, then the start time when one is set: "Morning service · 10:00 AM". */
export function serviceSlotLine(slot: string | null | undefined, services?: ServiceSettings): string | null {
  const name = serviceSlotName(slot, services), time = serviceSlotTime(slot, services);
  return name && time ? `${name} · ${time}` : name;
}
