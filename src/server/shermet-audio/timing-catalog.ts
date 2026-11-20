import { parseShermetTiming, type ShermetTiming } from "../../lib/reference-audio/shermet-timing";
// Generated SHA-bound numerical metadata. Book shards load only when requested.
const loaders: Record<string, () => Promise<{ default: readonly ShermetTiming[] }>> = {"Numbers": () => import("./timing-shards/numbers"),"Genesis": () => import("./timing-shards/genesis"),"Judges": () => import("./timing-shards/judges"),"Exodus": () => import("./timing-shards/exodus"),"Hosea": () => import("./timing-shards/hosea"),"Isaiah": () => import("./timing-shards/isaiah"),"Deuteronomy": () => import("./timing-shards/deuteronomy"),"II Kings": () => import("./timing-shards/ii-kings"),"Leviticus": () => import("./timing-shards/leviticus"),"Malachi": () => import("./timing-shards/malachi"),"Obadiah": () => import("./timing-shards/obadiah"),"Zechariah": () => import("./timing-shards/zechariah"),"I Kings": () => import("./timing-shards/i-kings"),"Jeremiah": () => import("./timing-shards/jeremiah"),"Amos": () => import("./timing-shards/amos"),"Joshua": () => import("./timing-shards/joshua"),"Micah": () => import("./timing-shards/micah"),"I Samuel": () => import("./timing-shards/i-samuel"),"Ezekiel": () => import("./timing-shards/ezekiel"),"II Samuel": () => import("./timing-shards/ii-samuel")};
export async function getShermetTiming(ref: string, audioSha256: string): Promise<ShermetTiming | null> {
 const load = loaders[ref.replace(/ [0-9]+:[0-9]+$/, "")]; if (!load) return null;
 const rows = (await load()).default.filter(row => row.ref === ref && row.audioSha256 === audioSha256);
 return rows.length === 1 ? parseShermetTiming(rows[0]) : null;
}
// Compatibility seed; runtime routes use the lazy lookup above.
export const SHERMET_TIMINGS: readonly ShermetTiming[] = [];
