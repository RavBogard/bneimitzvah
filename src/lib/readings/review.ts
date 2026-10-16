import { parseCeremonyDate } from "./ranges";
import { serviceSlot } from "./reading-date";

// Metadata and assigned text must describe the same confirmed assignment.
// Review status does not remove access to its preserved, authorized verses.
export function assignmentNeedsReview(value: unknown, ceremonyDate: string): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return true;
  const snapshot = value as Record<string, unknown>;
  try {
    serviceSlot(snapshot.serviceSlot);
    return snapshot.slotProvenance !== 1 || snapshot.needsReview !== false
      || parseCeremonyDate(snapshot.confirmationDate) !== ceremonyDate;
  } catch { return true; }
}
