export const SHERMET_CATEGORIES = { blessing: "Blessings and prayers", lesson: "Trope lessons", "holiday-variant": "Holiday readings", megillah: "Megillot", "festival-song": "Festival songs", "source-conflict": "Source variants", unclassified: "Other recordings" } as const;
export type ShermetCategory = keyof typeof SHERMET_CATEGORIES;
export type ShermetLibraryRecording = Readonly<{ sourceId: number; sha256: string; duration: number; bytes: number; mimeType?: "audio/mpeg" | "audio/wav" }>;
export type ShermetLibraryItem = Readonly<{ id: string; category: ShermetCategory; title: string; label: string; pageUrl: string; ref?: string; kind?: string; recordings: readonly ShermetLibraryRecording[]; status: "available" | "pending" | "missing" }>;
/** Corrected identity leads whenever the original source label conflicted. */
export const shermetLibraryTitle = (item: ShermetLibraryItem) => item.category === "source-conflict" ? item.ref ?? "Recording identity unconfirmed" : item.label;
/** Exact source labels matched to the corresponding CRC prayer lesson. These
 * stable IDs never choose a holiday melody or a similarly named other prayer. */
export const SHERMET_SERVICE_ITEMS: Readonly<Record<string, string>> = {
  shma: "sr_fd623283fb9298d63fd65fbccad3e562", vahavta: "sr_5cdf4108f6002a6ab2b21f2fadaf23ea",
  "torah-before": "sr_4c70bb6ea3a0beb2d4b0d29faf007578", "torah-after": "sr_f5bad63a3d279d05b6aa9521b6be1130",
  "haftarah-before": "sr_3dcc10899870a6f1b58c488609e10924", "haftarah-after": "sr_a78d678cb36aed0d84252bef5a505060",
  "adon-olam": "sr_bd321ad9090b3e603d510f5790eac64b", tallit: "sr_1cb462d34492366763ac7953aae10813",
  "mah-tovu": "sr_381ef40cae8ba07cf04df26a961edff6", aleinu: "sr_2fc7f0ee3c972514b8021358717d8c69",
  "mourners-kaddish": "sr_93419c24a98b5be1017432ea2b6b37b1", "oseh-shalom": "sr_a8ab860a924420a6edb64dbcded5a4aa",
  "ahavah-rabbah": "sr_ec5eff4f309760c73a915c5d3b95923d", "sim-shalom": "sr_d3966eec3cdf074a69878cbb7d59dd82",
  kdushah: "sr_637594c8f22cc45bcacfffbaca24b028", "yotzeir-or": "sr_5f13ef94bfa0de57358f0df8422c3fcc",
  gvurot: "sr_77c3858b216899395b2314ffe8cddd2c", vshamru: "sr_3404519d25f6117df7edeac9fa582f5c",
  "eitz-chayim": "sr_a108b6ff57023697c3bb2e134f22956f", "mi-chamochah": "sr_0d5138fe8a6485d366ffb08c79587003",
  barchu: "sr_e71428752ebad9b2b109e2a51af872d0", "barchu-evening": "sr_255a3556f6a2a89468a0129d6c0fea94",
  "chatzi-kaddish": "sr_f95ebd78b19e30499cd436b64de269a6", "chatzi-kaddish-evening": "sr_de0632243bff3b3ac813cd61be4cc554",
};
export function validLibraryRecording(value: unknown): value is ShermetLibraryRecording {
  if (!value || typeof value !== "object") return false;
  const row = value as ShermetLibraryRecording;
  return Number.isSafeInteger(row.sourceId) && row.sourceId > 0 && typeof row.sha256 === "string" && /^[a-f0-9]{64}$/.test(row.sha256)
    && Number.isFinite(row.duration) && row.duration > 0 && Number.isSafeInteger(row.bytes) && row.bytes > 0 && row.bytes <= 20 * 1024 * 1024 && (row.mimeType === undefined || ["audio/mpeg", "audio/wav"].includes(row.mimeType));
}
export function parseShermetLibrary(value: unknown): readonly ShermetLibraryItem[] {
  if (!value || typeof value !== "object") return [];
  const row = value as { version: unknown; items: unknown };
  if (row.version !== 1 || !Array.isArray(row.items) || row.items.length > 30000) return [];
  const items: ShermetLibraryItem[] = [], ids = new Set<string>();
  for (const value of row.items) {
    if (!value || typeof value !== "object") continue;
    const item = value as ShermetLibraryItem;
    if (!/^sr_[a-f0-9]{32}$/.test(item.id) || ids.has(item.id) || !Object.hasOwn(SHERMET_CATEGORIES, item.category) || !["available", "pending", "missing"].includes(item.status)
      || ![item.title, item.label].every(text => typeof text === "string" && text.length > 0 && text.length <= 2000) || !Array.isArray(item.recordings)) continue;
    let source: URL; try { source = new URL(item.pageUrl); } catch { continue; }
    if (source.protocol !== "https:" || !["www.templeisraelomaha.com", "templeisraelomaha.com", "voices.sefaria.org"].includes(source.hostname) || source.username || source.password || source.port) continue;
    ids.add(item.id);
    items.push({ ...item, recordings: item.recordings.filter(validLibraryRecording) });
  }
  return items;
}
