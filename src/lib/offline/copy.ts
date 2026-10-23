/**
 * Every user-visible string of the installable app, in one place. `{productName}` is the congregation's own
 * name (E1); CRC's is "CRC Torah".
 *
 * PLAN strings are Daniel's wording from the 1.5 plan's 2026-10-23 rulings (B4, popup rulings) and its §3.5
 * and §3.9 text; the Android fallback is the research report's sentence, approved verbatim by Daniel on
 * 2026-10-23. NEW strings are labels the plan does not word; each is listed in the PR for Daniel.
 */
export const PLAN = Object.freeze({
  installHint: (productName: string) => `Install ${productName} on this device to keep this week’s reading and recordings for use offline (up to about 40 MB).`,
  iphoneSteps: "In Safari, tap Share, then scroll to Add to Home Screen. If you don’t see Share, tap the menu button next to the address bar first. Keep Open as Web App on, then tap Add.",
  ipadSteps: "In Safari, tap Share, then View More, then Add to Home Screen. Keep Open as Web App on, then tap Add.",
  /** Daniel approved this verbatim on 2026-10-23. */
  androidMenu: "In Chrome, open the menu and tap Install app or Add to Home screen.",
  installButton: (productName: string) => `Install ${productName}`,
  notNow: "Not now",
  pill: (date: string) => `Offline · saved until ${date}`,
  expiry: (productName: string) => `Saved readings stay on this device for 14 days after you last opened ${productName} online. Open it with a connection to renew them. If the device runs low on space, it may remove them sooner.`,
  saved: "Saved on this device",
  partly: "Partly saved",
  noSpace: "Not saved: not enough space on this device.",
  needsConnection: "Needs a connection",
  remove: "Remove saved readings from this device",
  open: "Open",
});

/** Wording the plan does not give. Each is one named constant, flagged for Daniel. */
export const NEW = Object.freeze({
  /** /offline: the label of the This week pack in the saved list (the reader's own page title). */
  weekLabel: "This week’s reading",
  /** /offline: the label of the course pack (the front door's own door title). */
  courseLabel: "Learn to lein",
  /** /offline: shown when nothing is saved on this device. */
  nothingSaved: "Nothing is saved on this device yet.",
  /** /offline: the line after Remove has run. */
  removed: "Saved readings were removed from this device.",
  /** /offline: each saved item's expiry, from the pill's own wording. */
  savedUntil: (date: string) => `Saved until ${date}`,
  /** The offline pill when the device is offline and no saved reading is live. */
  offline: "Offline",
});
