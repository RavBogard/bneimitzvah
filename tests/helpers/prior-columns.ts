/**
 * Rows read after the full migration chain, limited to the columns the rows had before the migration
 * under test. Later additive migrations (0029's rehearsal dates, for example) add nullable columns;
 * an older migration's upgrade test still proves it left every existing value untouched.
 */
export function priorColumns(after: readonly unknown[], before: readonly unknown[]) {
  const keys = new Set(before.flatMap(row => Object.keys(row as Record<string, unknown>)));
  return after.map(row => Object.fromEntries(Object.entries(row as Record<string, unknown>).filter(([key]) => keys.has(key))));
}
