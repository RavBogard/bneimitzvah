import { parseShermetTiming, type ShermetTiming } from "../../lib/reference-audio/shermet-timing";
// Generated SHA-bound numerical metadata. Book shards load only when requested.
const loaders: Record<string, () => Promise<{ default: readonly ShermetTiming[] }>> = {"Numbers": () => import("./timing-shards/numbers"),"Exodus": () => import("./timing-shards/exodus"),"Isaiah": () => import("./timing-shards/isaiah"),"Genesis": () => import("./timing-shards/genesis"),"Jonah": () => import("./timing-shards/jonah"),"Joshua": () => import("./timing-shards/joshua"),"Judges": () => import("./timing-shards/judges"),"Leviticus": () => import("./timing-shards/leviticus"),"Deuteronomy": () => import("./timing-shards/deuteronomy"),"Ezekiel": () => import("./timing-shards/ezekiel"),"Hosea": () => import("./timing-shards/hosea"),"I Kings": () => import("./timing-shards/i-kings"),"I Samuel": () => import("./timing-shards/i-samuel"),"Joel": () => import("./timing-shards/joel"),"II Samuel": () => import("./timing-shards/ii-samuel"),"Malachi": () => import("./timing-shards/malachi"),"Habakkuk": () => import("./timing-shards/habakkuk"),"II Kings": () => import("./timing-shards/ii-kings"),"Jeremiah": () => import("./timing-shards/jeremiah"),"Zechariah": () => import("./timing-shards/zechariah"),"Obadiah": () => import("./timing-shards/obadiah"),"Micah": () => import("./timing-shards/micah"),"Amos": () => import("./timing-shards/amos")};
export async function getShermetTiming(ref: string, audioSha256: string): Promise<ShermetTiming | null> {
 const load = loaders[ref.replace(/ [0-9]+:[0-9]+$/, "")]; if (!load) return null;
 const rows = (await load()).default.filter(row => row.ref === ref && row.audioSha256 === audioSha256);
 return rows.length === 1 ? parseShermetTiming(rows[0]) : null;
}
// Compatibility seed; runtime routes use the lazy lookup above.
export const SHERMET_TIMINGS: readonly ShermetTiming[] = [];
