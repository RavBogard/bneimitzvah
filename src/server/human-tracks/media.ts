import { humanTrackById, humanTrackPlayable, karaiteTrackSource, type HumanTrack } from "../../lib/reference-audio/human-tracks";

export type TrackMedia = { body: ReadableStream<Uint8Array> | null; headers: Pick<Headers, "get" | "has"> };
const mime = "audio/mpeg";
const base = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const missing = () => new Response(null, { status: 404, headers: base });

/** Only the CRC public catalog names objects. Request parameters never become a URL or a blob key. */
export function createHumanTrackMedia(input: {
  enabled: boolean;
  track?: (id: string) => HumanTrack | undefined;
  upstream: (track: HumanTrack, options: { range: string | null; head: boolean; signal: AbortSignal }) => Promise<TrackMedia | null>;
}) {
  return async (request: Request, id: string) => {
    const track = input.enabled ? (input.track ?? humanTrackById)(id) : undefined;
    if (!track || !humanTrackPlayable(track)) return missing();
    const url = new URL(request.url);
    if (url.search && (!track.sha256 || url.search !== "?copy=" + track.sha256)) return missing();
    const head = request.method === "HEAD";
    const raw = request.headers.get("range");
    const range = head || request.headers.has("if-range") ? null : raw;
    if (range && !validRequestRange(range, track.bytes)) {
      return new Response(null, { status: 416, headers: { ...base, ...(track.bytes ? { "Content-Range": "bytes */" + track.bytes } : {}) } });
    }
    try {
      const media = await input.upstream(track, { range, head, signal: AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]) });
      if (!media) return missing();
      const { headers: source, body } = media;
      const cancel = () => { if (body) void body.cancel().catch(() => {}); };
      const length = Number(source.get("content-length")), contentRange = source.get("content-range");
      const part = contentRange && /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange);
      const type = source.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
      if ((!head && !body) || type !== mime && type !== "audio/mp3" || !Number.isSafeInteger(length) || length <= 0 ||
          source.has("content-encoding") && source.get("content-encoding") !== "identity" ||
          contentRange && (!part || !range || !validRange(part, range, length, track.bytes)) ||
          !contentRange && track.bytes && length !== track.bytes) {
        cancel(); return missing();
      }
      const headers = new Headers({ ...base, "Content-Type": mime, "Content-Length": String(length) });
      if (part || source.get("accept-ranges") === "bytes") headers.set("Accept-Ranges", "bytes");
      if (part) headers.set("Content-Range", contentRange!);
      if (head) cancel();
      return new Response(head ? null : body, { status: part ? 206 : 200, headers });
    } catch { return missing(); }
  };
}

function validRequestRange(range: string, total?: number) {
  const match = /^bytes=(\d{0,12})-(\d{0,12})$/.exec(range);
  if (!match) return false;
  const [, first, last] = match;
  if (!first) return last !== "" && Number(last) > 0;
  return (!last || Number(last) >= Number(first)) && (!total || Number(first) < total);
}

function validRange(part: RegExpExecArray, range: string, length: number, expected?: number) {
  const [start, end, total] = part.slice(1).map(Number);
  if (![start, end, total].every(Number.isSafeInteger) || start < 0 || end < start || end >= total || end - start + 1 !== length || expected && total !== expected) return false;
  const [first, last] = range.slice(6).split("-");
  return first ? start === Number(first) && end === (last ? Math.min(Number(last), total - 1) : total - 1)
    : start === Math.max(0, total - Number(last)) && end === total - 1;
}

export async function publishedKaraiteMedia(track: HumanTrack, { range, head, signal }: { range: string | null; head: boolean; signal: AbortSignal }, fetcher = fetch) {
  const url = karaiteTrackSource(track.streamUrl);
  if (!url) return null;
  const response = await fetcher(url, { method: head ? "HEAD" : "GET", headers: range ? { Range: range } : {}, redirect: "error", credentials: "omit", cache: "no-store", signal });
  if (response.status === 200 || response.status === 206) return { body: response.body, headers: response.headers };
  if (response.body) void response.body.cancel().catch(() => {});
  return null;
}
