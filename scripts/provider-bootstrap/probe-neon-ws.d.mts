export const PROBE_PHASES: readonly ["configuration", "connection", "catalog", "role", "no-context", "empty-context", "crc-write", "wrong-context", "rollback-cleanup", "commit-cleanup", "parallel-context", "host", "close", "runner"];
export type ProbeResult = { status: "passed" | "failed"; phase: typeof PROBE_PHASES[number] };
export function restrictedProbeInput(contents: string): string;
export function restrictedChildEnvironment(ambient: Record<string, string | undefined>, databaseUrl: string): Record<string, string | undefined>;
export function sanitizedProbeResult(output: string): ProbeResult;
export function runRestrictedProbe(argv: string[], ambient?: Record<string, string | undefined>): Promise<ProbeResult>;
