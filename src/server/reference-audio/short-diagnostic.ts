import "server-only";

const stages = ["function-reached", "config-selected", "config-rejected", "config-drift", "request-length", "request-origin", "request-path", "request-host", "request-forwarding", "request-framing", "request-invalid"] as const;
type Stage = typeof stages[number];
const predicates = ["release", "portalEnvironment", "portalDeployment", "platform", "platformEnvironment", "nodeEnvironment", "origin", "catalogDigest", "manifestDigest", "storeShape", "serverOverrideAbsent", "publicOverrideAbsent"] as const;
const fields: Partial<Record<Stage, readonly string[]>> = {
  "config-rejected": predicates,
  "request-origin": ["originMatches", "canonicalURL", "userinfoAbsent", "queryAbsent", "fragmentAbsent"],
  "request-host": ["hostMatches", "forwardedHostMatches"],
  "request-forwarding": ["protocolMatches", "portMatches", "forwardedAbsent"],
  "request-framing": ["transferEncodingAbsent", "contentLengthAbsentOrZero"],
};

/** Private, bounded diagnosis only. Never log caller values or affect a request. */
export function createShortDiagnosticReporter(write: (record: Readonly<Record<string, unknown>>) => void = record => console.warn(JSON.stringify(record))) {
  const seen = new Set<Stage>();
  return (stage: Stage, facts?: () => unknown): void => {
    try {
      if (!stages.includes(stage) || seen.has(stage) || seen.size >= 12) return;
      seen.add(stage);
      const record: Record<string, unknown> = { event: "reference-short-diagnostic/v1", stage };
      if (fields[stage]) {
        const value = facts?.();
        if (value && typeof value === "object") for (const key of fields[stage]) {
          const match = (value as Record<string, unknown>)[key];
          if (typeof match === "boolean") record[key] = match;
        }
      }
      write(Object.freeze(record));
    } catch { /* Diagnostics, including hostile/throwing sinks, are best-effort. */ }
  };
}

export const reportShortDiagnostic = createShortDiagnosticReporter();
