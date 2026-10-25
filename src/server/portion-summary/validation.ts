import { markdown, plain } from "../study-guides/validation";
import { NAMED_READINGS, namedReading, type NamedReading } from "../../lib/readings/named-readings";
import { OUTLINE_ALIYOT } from "../../lib/portion-summary/credit";

/**
 * Portion summaries (1.9 N6, decision 4): the shapes the MCP tools accept, closed. A summary is prose under the guide prose
 * rules (paragraphs, emphasis and lists; no links, no HTML, no hidden characters) of at most 4 KB, and an outline of exactly
 * seven plain lines, one per aliyah. The SQL CHECKs in migration 0044 hold the same bounds.
 */
export const PORTION_SUMMARY_LIMITS = Object.freeze({ summaryBytes: 4096, lineBytes: 240, aliyot: OUTLINE_ALIYOT.length });
export type PortionSummaryInput = Readonly<{ summary: string; outline: readonly string[] }>;
type Result<T> = { ok: true; value: T } | { ok: false; problems: string[] };

const squash = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
/**
 * A parashah from the portal's reading list, by slug ("vayera") or by its usual name ("Vayera", "Lech Lecha"). Special
 * Shabbatot, festivals and fasts are not parashiyot and have no portion summary.
 */
export function parashahOf(value: unknown): NamedReading | null {
  if (typeof value !== "string" || value.length > 80) return null;
  const wanted = squash(value);
  const found = namedReading(value) ?? (wanted ? NAMED_READINGS.find(reading => squash(reading.name) === wanted || squash(reading.slug) === wanted) ?? null : null);
  return found && found.group === "parashah" ? found : null;
}

export function validateSummary(value: Record<string, unknown>): Result<PortionSummaryInput> {
  const allowed = ["summary", "outline"], unknown = Object.keys(value).filter(key => !allowed.includes(key));
  if (unknown.length) return { ok: false, problems: [`A portion summary is its summary and its outline only; not ${unknown.join(", ")}`] };
  const problems: string[] = [];
  markdown(value.summary, PORTION_SUMMARY_LIMITS.summaryBytes, problems, "summary");
  const outline = value.outline;
  if (!Array.isArray(outline) || outline.length !== PORTION_SUMMARY_LIMITS.aliyot) problems.push(`outline: exactly ${PORTION_SUMMARY_LIMITS.aliyot} lines, one for each aliyah in order`);
  else outline.forEach((line, i) => { if (!plain(line, PORTION_SUMMARY_LIMITS.lineBytes)) problems.push(`outline[${i}]: aliyah ${i + 1} as one plain line of at most ${PORTION_SUMMARY_LIMITS.lineBytes} bytes`); });
  return problems.length ? { ok: false, problems } : { ok: true, value: Object.freeze({ summary: value.summary as string, outline: Object.freeze([...(outline as string[])]) }) };
}
