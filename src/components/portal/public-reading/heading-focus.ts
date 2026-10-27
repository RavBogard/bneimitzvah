/**
 * Moving to another reading is a new page, so focus would start on the body. This tab asks the next page to land focus on the new
 * reading's heading once the reading is shown (F-SITE 25); the ask is short-lived and spent by the first reading that shows. Kept apart
 * from the reader so the Readings index and Find a reading can ask without loading it.
 */
export const HEADING_FOCUS = "crc-torah:reading-focus/v1", HEADING_FOCUS_MS = 30_000;
export const go = (address: string) => { try { window.location.assign(address); } catch { /* Stay. */ } };
export function goToReading(address: string) {
  try { window.sessionStorage.setItem(HEADING_FOCUS, String(Date.now())); } catch { /* Focus starts on the page, as before. */ }
  go(address);
}
