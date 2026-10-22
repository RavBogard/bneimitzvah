/** The family-facing service names the honors sheet uses. Nothing for an unconfirmed or missing slot, and no times are implied. */
export function serviceSlotName(slot: string | null | undefined): string | null {
  return slot === "morning" ? "Morning service" : slot === "havdalah" ? "Havdalah service" : null;
}
