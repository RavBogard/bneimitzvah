import { parseShermetTiming, type ShermetTiming } from "../../lib/reference-audio/shermet-timing";
// Generated SHA-bound numerical metadata. Book shards load only when requested.
const loaders: Record<string, () => Promise<{ default: readonly ShermetTiming[] }>> = {"Genesis": () => import("./timing-shards/genesis"),"Exodus": () => import("./timing-shards/exodus"),"Isaiah": () => import("./timing-shards/isaiah"),"II Kings": () => import("./timing-shards/ii-kings"),"Numbers": () => import("./timing-shards/numbers"),"Judges": () => import("./timing-shards/judges"),"Hosea": () => import("./timing-shards/hosea"),"Zechariah": () => import("./timing-shards/zechariah"),"I Kings": () => import("./timing-shards/i-kings"),"Micah": () => import("./timing-shards/micah")};
export async function getShermetTiming(ref: string, audioSha256: string): Promise<ShermetTiming | null> {
 const load = loaders[ref.replace(/ [0-9]+:[0-9]+$/, "")]; if (!load) return null;
 const rows = (await load()).default.filter(row => row.ref === ref && row.audioSha256 === audioSha256);
 return rows.length === 1 ? parseShermetTiming(rows[0]) : null;
}
// Compatibility seed; runtime routes use the lazy lookup above.
export const SHERMET_TIMINGS: readonly ShermetTiming[] = [];
