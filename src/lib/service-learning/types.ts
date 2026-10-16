// Type-only references are erased; client code never imports the server parser.
import type { ServiceBlock as FeedBlock, ServiceSpan as FeedSpan, ServiceUnit as FeedUnit } from "../../server/service-learning/feed";
export type ServiceSpan = FeedSpan;
export type ServiceBlock = Omit<FeedBlock, "bare" | "folio" | "phys">;
export type ServiceUnit = Omit<FeedUnit, "blocks" | "folios" | "printedFolio" | "companionOf" | "companionRole" | "renderSegments"> & {
  blocks: readonly ServiceBlock[];
  renderSegments?: Readonly<{ he: readonly string[]; en: readonly string[] }>;
};
export type ServiceSectionHeading = Readonly<{ idx: number; en?: string | null; he?: string | null; opener?: boolean }>;
export type ServiceLicense = Readonly<{ spdx: string; attribution?: string }>;
export type ServiceSourceIdentity = Readonly<{ catalogIdentity: string; sourceGitSha: string; sourceBuiltAt: string;
  artifactCommit: string; artifactRunId: string }>;
export type ServiceUnitMaterial = Readonly<{ unit: ServiceUnit; section: ServiceSectionHeading; license: ServiceLicense;
  source: ServiceSourceIdentity; blockGranularity?: "line" | "stanza" }>;
