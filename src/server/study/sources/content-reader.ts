import "server-only";
import { SourceContentUnavailable, SOURCE_CONTENT_LIMITS, MOTHER_TONGUES, type ContentSelection } from "./content";
import { sourceMetadataWork } from "./metadata";
const BOUNDS = Object.freeze({totalMs:10000,idleMs:5000,emptyReads:64,headerLength:128});
const fail=():never=>{throw new SourceContentUnavailable();};
const typedArray=Object.getPrototypeOf(Uint8Array.prototype);
const byteLength=Object.getOwnPropertyDescriptor(typedArray,"byteLength")!.get!;
const byteOffset=Object.getOwnPropertyDescriptor(typedArray,"byteOffset")!.get!;
const arrayBuffer=Object.getOwnPropertyDescriptor(typedArray,"buffer")!.get!;
export function createSefariaContentReader(input:{fetch?:typeof globalThis.fetch}={}){
  const fetcher=input.fetch??globalThis.fetch;
  async function request<T>(url: URL, signal: AbortSignal, parse: (value: unknown) => T): Promise<T> {
    const abort = new AbortController(), start = performance.now(), end = start + BOUNDS.totalMs;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, incoming: Response | undefined, receivedAt = start;
    const canceled = new WeakSet<object>();
    const cancel = (body?: ReadableStream<Uint8Array> | null) => { try { if (body && !canceled.has(body)) { canceled.add(body); void body.cancel().catch(() => {}); } } catch {} };
    const cancelResponse = (value?: Response) => { try { cancel(value?.body); } catch {} };
    const onAbort = () => abort.abort(); if (signal.aborted) onAbort(); signal.addEventListener("abort", onAbort, { once: true });
    const totalTimer = setTimeout(() => abort.abort(), BOUNDS.totalMs);
    const live = () => { if (signal.aborted || abort.signal.aborted || performance.now() >= end) return fail(); };
    async function wait<V>(pending: Promise<V>, until: number, late?: (value: V) => void): Promise<V> {
      let expired = false, timer: ReturnType<typeof setTimeout> | undefined, stop: (() => void) | undefined;
      const observed = pending.then(value => { if (expired || abort.signal.aborted) { late?.(value); return fail(); } return value; });
      try {
        const value = await Promise.race([observed, new Promise<never>((_, reject) => {
          stop = () => { expired = true; reject(new SourceContentUnavailable()); }; abort.signal.addEventListener("abort", stop, { once: true });
          timer = setTimeout(() => { expired = true; reject(new SourceContentUnavailable()); }, Math.max(1, Math.min(end, until) - performance.now()));
          if (abort.signal.aborted) stop();
        })]);
        try { live(); if (performance.now() >= until) return fail(); return value; } catch (error) { late?.(value); throw error; }
      } finally { if (timer) clearTimeout(timer); if (stop) abort.signal.removeEventListener("abort", stop); }
    }
    try {
      live();
      const pending = Promise.resolve(fetcher(url.href, { method: "GET", headers: { accept: "application/json" }, credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", cache: "no-store", signal: abort.signal }))
        .then(value => { incoming = value; receivedAt = performance.now(); if (abort.signal.aborted) cancelResponse(value); return value; });
      const response = await wait(pending, end, cancelResponse);
      const type = response.headers.get("content-type"), length = response.headers.get("content-length");
      if (response.status !== 200 || response.redirected || response.url && response.url !== url.href || !response.body
        || !type || type.length > BOUNDS.headerLength || !/^application\/json(?:\s*;\s*charset\s*=\s*utf-?8)?$/i.test(type)
        || length !== null && (!/^(?:0|[1-9][0-9]{0,9})$/.test(length) || Number(length) > SOURCE_CONTENT_LIMITS.bytes)) return fail();
      live(); reader = response.body.getReader();
      const bytes = new Uint8Array(SOURCE_CONTENT_LIMITS.bytes); let count = 0, empty = 0, progress = receivedAt;
      while (true) {
        live(); const idleEnd = progress + BOUNDS.idleMs; if (performance.now() >= idleEnd) return fail();
        const part = await wait(reader.read(), idleEnd); if (performance.now() >= idleEnd) return fail();
        if (part.done) break;
        if (!(part.value instanceof Uint8Array)) return fail();
        const length: number = byteLength.call(part.value);
        if (length > bytes.length - count) return fail();
        if (!length) { if (++empty > BOUNDS.emptyReads) return fail(); continue; }
        // Never trust shadowable .buffer/.byteLength or caller iteration hooks.
        bytes.set(new Uint8Array(arrayBuffer.call(part.value), byteOffset.call(part.value), length), count); count += length; progress = performance.now(); empty = 0;
      }
      live(); const decoded: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, count))); live();
      const result = parse(decoded); live(); return result;
    } catch { abort.abort(); return fail(); }
    finally {
      clearTimeout(totalTimer); signal.removeEventListener("abort", onAbort);
      if (reader) { try { void reader.cancel().catch(() => {}); } catch {} try { reader.releaseLock(); } catch {} }
      else cancelResponse(incoming);
    }
  }
  return Object.freeze({async text(selection:ContentSelection,signal:AbortSignal):Promise<unknown>{
    try {
      const ref=sourceMetadataWork(selection.ref),work=sourceMetadataWork(selection.indexTitle),title=sourceMetadataWork(selection.editionTitle);
      if(!ref.startsWith(work+" ")||!/^([1-9][0-9]*)(:[1-9][0-9]*)*$/.test(ref.slice(work.length+1))||title.includes("|")||selection.actualLanguage!=="he"&&selection.actualLanguage!=="en"||selection.motherTongue!==MOTHER_TONGUES[selection.actualLanguage])return fail();
      const url=new URL(`https://www.sefaria.org/api/v3/texts/${encodeURIComponent(ref)}`);
      url.searchParams.set("version",`${selection.motherTongue}|${title}`);url.searchParams.set("fill_in_missing_segments","0");url.searchParams.set("return_format","text_only");
      return await request(url,signal,value=>value);
    }catch{return fail();}
  }});
}
