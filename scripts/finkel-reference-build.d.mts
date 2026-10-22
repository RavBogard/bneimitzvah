export type FinkelBuildClip = { asset: string; kind: "torah" | "haftarah"; mode: "chant" | "spoken"; verses: string[]; sha256: string; bytes: number; durationSeconds: number; preferred: boolean };
export type FinkelPlanObject = { key: string; file: string; sha256: string; bytes: number; contentType: "audio/mpeg" | "application/json" };
export type FinkelPlan = { schema: "finkel-reference-upload-plan/v1"; manifestSha256: string; objects: FinkelPlanObject[] };
export type FinkelCliResult = { ok: boolean; missing: boolean };
export const FINKEL_BUILD: Readonly<{ manifestSchema: "finkel-reference-manifest/v1"; planSchema: "finkel-reference-upload-plan/v1"; catalogSchema: "finkel-prepared-catalog/v1";
  catalogBytes: number; clipBytes: number; manifestBytes: number; audioKey(sha256: string): string; manifestKey(sha256: string): string }>;
export class FinkelBuildError extends Error { readonly code: string; constructor(code: string); }
export function verseOrdinal(ref: unknown): { book: string; chapter: number; ordinal: number } | null;
export function selectFinkelClips(catalog: unknown): { clips: FinkelBuildClip[]; skipped: Record<"held" | "drill" | "tempo" | "notScripture" | "oversize", number> };
export function buildFinkelManifest(clips: readonly unknown[]): { bytes: Uint8Array; sha256: string };
export function finkelCoverage(clips: readonly FinkelBuildClip[]): Record<string, unknown>;
export function buildFinkelReference(input: { packageDir: string; outDir: string; holdFile?: string }): Promise<{ manifestSha256: string; coverage: Record<string, unknown>; skipped: Record<string, number>; objects: number }>;
export function readFinkelPlan(planFile: string): Promise<FinkelPlan>;
export function vercelRunner(cwd: string): (args: string[]) => Promise<FinkelCliResult>;
export function publishFinkelPlan(plan: FinkelPlan, run: (args: string[]) => Promise<FinkelCliResult>, options?: { dryRun?: boolean; scratch?: string }): Promise<{ existing: number; created: number; wouldCreate: number }>;
export function verifyFinkelPlan(plan: FinkelPlan, run: (args: string[]) => Promise<FinkelCliResult>, options?: { scratch?: string }): Promise<{ verified: number; missing: number; differing: number; total: number }>;
