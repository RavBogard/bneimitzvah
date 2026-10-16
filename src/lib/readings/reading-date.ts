import { parseCeremonyDate, type CeremonyDate } from "./ranges";

export type ServiceSlot = "morning" | "havdalah" | "unknown";
export type DateFallback = "unknown-slot" | "non-saturday" | "calendar-date-out-of-range";
export function serviceSlot(value: unknown): ServiceSlot {
  if (value !== "morning" && value !== "havdalah" && value !== "unknown") throw new Error("Invalid service slot");
  return value;
}
// Calendar dates only. The displayed service times never drive timezone arithmetic.
export function readingDate(dateInput: unknown, slotInput: unknown): { readingDate: CeremonyDate | null; manualFallback: DateFallback | null } {
  const date = parseCeremonyDate(dateInput), slot = serviceSlot(slotInput);
  if (slot === "unknown") return { readingDate: null, manualFallback: "unknown-slot" };
  const day = new Date(`${date}T00:00:00Z`);
  if (day.getUTCDay() !== 6) return { readingDate: null, manualFallback: "non-saturday" };
  if (slot === "havdalah") day.setUTCDate(day.getUTCDate() + 7);
  if(day.getUTCFullYear()>9999)return {readingDate:null,manualFallback:"calendar-date-out-of-range"};
  return { readingDate: parseCeremonyDate(day.toISOString().slice(0, 10)), manualFallback: null };
}
