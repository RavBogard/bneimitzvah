import catalog from "./nonverse-catalog.json";
import { cantorRecordingsEnabled } from "../../lib/site/identity";
import { parseShermetLibrary, SHERMET_SERVICE_ITEMS, type ShermetLibraryItem } from "../../lib/reference-audio/shermet-library";
import { getVerifiedShermetMedia, shermetMediaResponse } from "./service";
const items = parseShermetLibrary(catalog);
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
export function createShermetLibrary(input: { enabled: boolean; items?: readonly ShermetLibraryItem[]; fetch?: typeof fetch }) {
  const library = input.enabled ? input.items ?? items : [];
  return {
    catalog(request: Request) {
      if (!input.enabled) return new Response(null, { status: 404, headers });
      const query = new URL(request.url).searchParams, q = (query.get("q") ?? "").trim().toLocaleLowerCase("en-US"), category = query.get("category") ?? "";
      const offset = Number(query.get("offset") ?? 0);
      if (q.length > 150 || !Number.isSafeInteger(offset) || offset < 0 || offset > 30000) return new Response(null, { status: 400, headers });
      const lesson = query.get("lesson"), service = query.get("course") === "service";
      const matches = library.filter(item => (!lesson || item.id === SHERMET_SERVICE_ITEMS[lesson]) && (!service || Object.values(SHERMET_SERVICE_ITEMS).includes(item.id)) && (!category || item.category === category) && (!q || `${item.title} ${item.label} ${item.ref ?? ""}`.toLocaleLowerCase("en-US").includes(q)));
      const page = matches.slice(offset, offset + 40);
      return Response.json({ items: page, nextOffset: offset + page.length < matches.length ? offset + page.length : null }, { headers });
    },
    async media(request: Request) {
      const query = new URL(request.url).searchParams;
      const id = query.get("id"), sha256 = query.get("recording");
      if (!id || !sha256 || query.size !== 2 || !/^sr_[a-f0-9]{32}$/.test(id) || !/^[a-f0-9]{64}$/.test(sha256)) return new Response(null, { status: 404, headers });
      const item = library.find(item => item.id === id && item.status === "available"), recording = item?.recordings.find(recording => recording.sha256 === sha256);
      const bytes = recording ? await getVerifiedShermetMedia(recording, input.fetch) : null;
      if (!bytes || !recording || bytes.length !== recording.bytes) return new Response(null, { status: 404, headers });
      return shermetMediaResponse(request, bytes, recording.mimeType ?? "audio/mpeg");
    },
  };
}
export const runtimeShermetLibrary = (env: Readonly<Record<string, string | undefined>> = process.env) => createShermetLibrary({ enabled: cantorRecordingsEnabled(env) });
