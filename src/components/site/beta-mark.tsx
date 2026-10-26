/**
 * The quiet "Beta" label beside the site name in every site header (Daniel, 2026-10-26: "List beta in the header for now").
 * Plain text in a small outline chip: not a link, not a button, nothing to announce beyond the word itself. It sits in the same
 * flex row as the name (the `.portal-brand-group` wrapper in globals.css), so the header does not move.
 */
export function BetaMark() {
  return <span className="site-beta" data-beta-mark="">Beta</span>;
}
