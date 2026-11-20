// Public-page metadata acquisition only. All inventory, receipts and audio stay outside Git.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { insideGitWorkingTree } from './private-paths.mjs';
import { loadCanonicalReading } from './shermet-source-runtime.mjs';
const run = promisify(execFile);
const digest = value => createHash('sha256').update(value).digest('hex');
const audioId = value => /^https:\/\/images\.shulcloud\.com\/14396\/(\d+)\.mp3$/.exec(value)?.[1];
const BOOKS = '(Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|(?:II|I|[12]) Samuel|(?:II|I|[12]) Kings|Isaiah|Jeremiah|Ezekiel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Haggai|Zechariah|Malachi|Ruth|Esther|Song of Songs|Ecclesiastes|Lamentations)';
const SINGLE_REF = new RegExp(`^${BOOKS} ([1-9]\\d*):([1-9]\\d*)$`);
const REF_SUFFIX = new RegExp(`(?:^|\\s)${BOOKS} ([1-9]\\d*):([1-9]\\d*)$`);
const normalizeLabel = value => value.replace(/\b([12]) (Samuel|Kings)\b/g, (_, n, book) => `${n === '2' ? 'II' : 'I'} ${book}`).replace(/\bEicha\b/g, 'Lamentations').replace(/\bKohelet\b/g, 'Ecclesiastes').replace(/\bShir haShirim\b/gi, 'Song of Songs').replace(/\b(Genesis|Exodus|Leviticus|Numbers|Deuteronomy)(?=\d)/g, '$1 ');
const TORAH_BOOKS = new Set(['Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy']);
const MEGILLOT = new Set(['Ruth', 'Esther', 'Song of Songs', 'Ecclesiastes', 'Lamentations']);
const publicPage = value => { try { const u = new URL(value); return u.protocol === 'https:' && u.hostname === 'www.templeisraelomaha.com' && !u.username && !u.password; } catch { return false; } };
const short = (value, max = 300) => typeof value === 'string' && value.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value);
async function readJson(path, fallback) { try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; } }
async function saveJson(path, value) { await writeFile(path, JSON.stringify(value, null, 2) + '\n'); }
async function outputRoot(directory) {
  if (!directory || await insideGitWorkingTree(directory)) throw new Error('Collection output must be outside every Git working tree');
  const root = resolve(directory); await mkdir(root, { recursive: true }); return root;
}

export function validateInventory(value) {
  if (value?.version !== 1 || !Array.isArray(value.pages) || value.pages.length > 1000) throw new Error('Expected a bounded version 1 page batch');
  return { version: 1, pages: value.pages.map(page => {
    if (!publicPage(page.url) || !short(page.title) || !Array.isArray(page.links) || !Array.isArray(page.rows) || page.links.length > 3000 || page.rows.length > 3000) throw new Error('Invalid public page metadata');
    return { url: page.url, title: page.title, links: page.links.map(link => {
      if (!short(link.text) || !short(link.href, 2000)) throw new Error('Invalid observed link');
      const u = new URL(link.href);
      if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error('Invalid observed link URL');
      return { text: link.text, href: link.href };
    }), rows: page.rows.map(row => {
      if (!short(row.label) || !Array.isArray(row.sources) || row.sources.length > 20 || row.sources.some(url => !audioId(url))) throw new Error('Invalid public audio row');
      return { label: row.label, sources: [...new Set(row.sources)] };
    }) };
  }) };
}

export async function saveInventory(root, batch) {
  const checked = validateInventory(batch);
  const previous = await readJson(join(root, 'inventory.json'), { version: 1, pages: [] });
  const pages = new Map(previous.pages.map(page => [page.url, page]));
  for (const page of checked.pages) pages.set(page.url, page);
  await appendFile(join(root, 'inventory-receipts.jsonl'), JSON.stringify({ receivedAt: new Date().toISOString(), sha256: digest(JSON.stringify(checked)), ...checked }) + '\n');
  await saveJson(join(root, 'inventory.json'), { version: 1, pages: [...pages.values()] });
  return { saved: checked.pages.length, totalPages: pages.size, totalRows: [...pages.values()].reduce((n, p) => n + p.rows.length, 0) };
}

export async function serveInventory(directory, port = 43121) {
  const root = await outputRoot(directory), origin = `http://127.0.0.1:${port}`;
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.headers.host !== `127.0.0.1:${port}`) { response.writeHead(403).end(); return; }
    if (request.method === 'GET' && request.url === '/') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end('<!doctype html><html lang="en"><title>Shermet public metadata receiver</title><body><h1>Save observed public recording metadata</h1><form method="post" action="/save"><label for="metadata">Public metadata JSON</label><br><textarea id="metadata" name="metadata" rows="20" cols="100"></textarea><br><button type="submit">Save metadata</button></form></body></html>'); return;
    }
    if (request.method !== 'POST' || request.url !== '/save' || request.headers.origin !== origin || !String(request.headers['content-type']).startsWith('application/x-www-form-urlencoded')) { response.writeHead(403).end(); return; }
    try {
      let body = ''; for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > 8_000_000) throw new Error('Batch too large'); }
      const result = await saveInventory(root, JSON.parse(new URLSearchParams(body).get('metadata')));
      response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(`<h1>Metadata saved</h1><pre>${JSON.stringify(result)}</pre><a href="/">Save another batch</a>`);
    } catch { response.writeHead(400, { 'Content-Type': 'text/plain' }).end('Metadata rejected; check the bounded public metadata schema.'); }
  });
  await new Promise((yes, no) => { server.once('error', no); server.listen(port, '127.0.0.1', yes); });
  console.log(JSON.stringify({ receiver: origin, directory: root, textarea: '#metadata', button: 'Save metadata' }));
  return server;
}

export async function acquireCollection(directory, maximum = 100, quiet = false) {
  const root = await outputRoot(directory);
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 1000) throw new Error('Batch size must be 1 to 1000');
  const inventory = validateInventory(await readJson(join(root, 'inventory.json'), null));
  const checkpoint = await readJson(join(root, 'acquisition.json'), { version: 1, media: {} });
  const ids = [...new Set(inventory.pages.flatMap(p => p.rows.flatMap(r => r.sources.map(audioId))))];
  const queue = ids.filter(id => { const prior = checkpoint.media[id]; return prior?.status !== 'verified' && !(prior?.status === 'failed' && Date.now() - Date.parse(prior.attemptedAt) < 15 * 60 * 1000); }).slice(0, maximum);
  let attempted = 0, nextStart = 0, checkpointWrite = Promise.resolve();
  async function worker() {
   while (queue.length) {
    const id = queue.shift();
    // Four workers, four aggregate request starts per second. CDN refusal stops
    // this bounded batch; no retries around access restrictions.
    const start = Math.max(Date.now(), nextStart); nextStart = start + 250;
    if (start > Date.now()) await new Promise(yes => setTimeout(yes, start - Date.now()));
    attempted++;
    const url = `https://images.shulcloud.com/14396/${id}.mp3`;
    try {
      const response = await fetch(url, { redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(60000) });
      if (!response.ok || !response.body) { if ([403, 406, 429].includes(response.status)) queue.length = 0; throw new Error(`HTTP ${response.status}`); }
      const chunks = []; let length = 0;
      for await (const chunk of response.body) { length += chunk.length; if (length > 20 * 1024 * 1024) throw new Error('Audio exceeds 20 MiB limit'); chunks.push(chunk); }
      const bytes = Buffer.concat(chunks), sha256 = digest(bytes), file = `${sha256}.mp3`, path = join(root, file);
      await writeFile(path, bytes);
      const probe = JSON.parse((await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,format_name:stream=codec_name,codec_type,sample_rate,channels', '-of', 'json', path], { windowsHide: true })).stdout);
      const mimeType = probe.format?.format_name === 'wav' && probe.streams?.some(s => s.codec_type === 'audio' && s.codec_name === 'pcm_s16le') ? 'audio/wav' : probe.streams?.some(s => s.codec_type === 'audio' && s.codec_name === 'mp3') ? 'audio/mpeg' : null;
      if (!mimeType || !(Number(probe.format?.duration) > 0)) throw new Error('Unsupported audio container/codec; inspect original before accepting');
      await run('ffmpeg', ['-v', 'error', '-xerror', '-i', path, '-f', 'null', '-'], { windowsHide: true });
      checkpoint.media[id] = { status: 'verified', sourceUrl: url, sha256, file, bytes: bytes.length, duration: Number(probe.format.duration), mimeType, streams: probe.streams, decode: 'passed', acquiredAt: new Date().toISOString() };
    } catch (error) { checkpoint.media[id] = { status: 'failed', sourceUrl: url, error: String(error.message).slice(0, 200), attemptedAt: new Date().toISOString() }; }
    checkpointWrite = checkpointWrite.then(() => saveJson(join(root, 'acquisition.json'), checkpoint));
    await checkpointWrite;
   }
  }
  await Promise.all(Array.from({ length: 4 }, () => worker()));
  const verified = ids.filter(id => checkpoint.media[id]?.status === 'verified').length;
  const result = { observedIds: ids.length, attempted, verified, remaining: ids.length - verified };
  if (!quiet) console.log(JSON.stringify(result)); return result;
}

/** Classification comes from exact visible row references and observed page hierarchy.
 * Variants and non-verse rows remain separate and never replace ordinary recordings. */
export function mapInventory(inventory, media = {}) {
  const checked = validateInventory(inventory), ordinary = [], variants = [], deferred = [];
  const incoming = new Map();
  for (const page of checked.pages) for (const link of page.links) {
    const list = incoming.get(link.href) ?? []; list.push({ page: page.url, title: page.title, label: link.text }); incoming.set(link.href, list);
  }
  for (const page of checked.pages) for (const row of page.rows) {
    const pageCorrections = {
      'https://www.templeisraelomaha.com/noah-exodus': { book: 'Genesis', chapters: [[6, 9, 22], [7, 1, 24], [8, 1, 22], [9, 1, 29], [10, 1, 32], [11, 1, 32]], reason: 'Genesis parent, row labels and all 153 canonical verse positions corroborate Genesis; page title says Exodus in error.' },
      'https://www.templeisraelomaha.com/bhaalotcha-numbers-81-1216.html': { book: 'Numbers', chapters: [[8, 1, 26], [9, 1, 23], [10, 1, 36], [11, 1, 35], [12, 1, 16]], reason: 'Numbers parent and title plus all 136 canonical positions corroborate Numbers; row book label says Exodus in error.' },
    };
    const correction = pageCorrections[page.url];
    const expected = correction?.chapters.flatMap(([c, begin, end]) => Array.from({ length: end - begin + 1 }, (_, i) => `${c}:${begin + i}`));
    const positions = correction ? page.rows.map(r => / ([1-9]\d*:[1-9]\d*)$/.exec(r.label)?.[1]) : null;
    const corrected = expected && expected.length === positions.length && expected.every((value, index) => value === positions[index]);
    const label = normalizeLabel(row.label.trim()).replace(corrected ? /\b(?:Genesis|Exodus|Numbers) (?=\d+:\d+$)/ : /$^/, corrected ? correction.book + ' ' : '');
    const match = REF_SUFFIX.exec(label);
    const ref = match ? `${match[1]} ${match[2]}:${match[3]}` : undefined;
    const context = `${page.title} ${new URL(page.url).pathname}`;
    const parents = incoming.get(page.url) ?? [];
    const parentContext = parents.map(p => `${p.title} ${p.label}`).join(' ');
    const holiday = /high.holiday|rosh.hashan|yom.kippur|holiday.torah|alternate|alternative|variant/i.test(context);
    // A dedicated holiday-only link is a variant even if its leaf title uses just a biblical reference.
    const holidayOnly = parents.length > 0 && parents.every(p => /high.holiday|rosh.hashan|yom.kippur|holiday.torah/i.test(`${p.title} ${p.label}`));
    const book = match?.[1], kind = book ? TORAH_BOOKS.has(book) ? 'torah' : MEGILLOT.has(book) ? 'megillah' : 'haftarah' : undefined;
    const category = (holiday || holidayOnly) && kind !== 'haftarah' ? 'holiday-variant' : kind === 'megillah' ? 'megillah' : /blessing|b.rach|berach|brach/i.test(context + parentContext + row.label) ? 'blessing' : /trope|lesson|cantillation|tutorial/i.test(context + parentContext) ? 'lesson' : /passover|pesach/i.test(context + parentContext) && !match ? 'festival-song' : match ? 'verse' : 'unclassified';
    const evidence = { pageUrl: page.url, pageTitle: page.title, rowLabel: row.label, parents, ...(corrected ? { correction: correction.reason } : {}) };
    const titleBooks = [...normalizeLabel(page.title).matchAll(new RegExp(`${BOOKS} (?:[1-9]\\d*:|Ch(?:apter)?\\b)`, 'gi'))].map(m => m[1].toLowerCase());
    if (match && titleBooks.length && !corrected && !titleBooks.includes(book.toLowerCase())) {
      deferred.push({ ...evidence, category: 'source-conflict', reason: 'Visible page title and row disagree on biblical book', sources: row.sources }); continue;
    }
    if (row.sources.length !== 1) { deferred.push({ ...evidence, category, reason: row.sources.length ? 'multiple audio alternatives' : 'no public audio source', sources: row.sources }); continue; }
    const sourceId = Number(audioId(row.sources[0])), acquired = media[String(sourceId)];
    const record = { ...(match ? { ref, kind } : {}), category, sourceId, ...(acquired?.status === 'verified' ? { sha256: acquired.sha256, bytes: acquired.bytes, duration: acquired.duration, mimeType: acquired.mimeType ?? 'audio/mpeg' } : {}), ...evidence };
    if (category === 'verse') ordinary.push(record); else variants.push(record);
  }
  const grouped = new Map();
  for (const entry of ordinary) { const key = `${entry.kind}:${entry.ref}`, list = grouped.get(key) ?? []; list.push(entry); grouped.set(key, list); }
  const recordings = [], conflicts = [];
  for (const list of grouped.values()) {
    const ids = new Set(list.map(entry => entry.sourceId));
    if (ids.size !== 1) { conflicts.push(...list); continue; }
    const entry = list.find(r => r.sha256);
    if (entry) recordings.push({ kind: entry.kind, ref: entry.ref, sourceId: entry.sourceId, sha256: entry.sha256, ...(Number.isSafeInteger(entry.bytes) ? { bytes: entry.bytes } : {}), mimeType: entry.mimeType ?? 'audio/mpeg' });
  }
  return { version: 1, recordings, variants, conflicts, deferred, provenance: ordinary,
    summary: { pages: checked.pages.length, observedRows: ordinary.length + variants.length + deferred.length,
      ordinaryReferences: grouped.size, verifiedOrdinaryReferences: recordings.length,
      torah: recordings.filter(r => r.kind === 'torah').length, haftarah: recordings.filter(r => r.kind === 'haftarah').length,
      variantRows: variants.length, conflictedRows: conflicts.length, deferredRows: deferred.length } };
}

export async function generateManifest(directory) {
  const root = await outputRoot(directory);
  const inventory = await readJson(join(root, 'inventory.json'), { version: 1, pages: [] });
  const checkpoint = await readJson(join(root, 'acquisition.json'), { media: {} });
  const result = mapInventory(inventory, checkpoint.media);
  const { canonicalReadingRef } = await loadCanonicalReading(root);
  result.recordings = result.recordings.filter(entry => {
    const parsed = canonicalReadingRef(entry.ref, entry.kind);
    if (parsed?.verses.length === 1 && parsed.verses[0] === entry.ref) return true;
    result.deferred.push({ category: 'source-conflict', pageUrl: result.provenance.find(p => p.ref === entry.ref)?.pageUrl, pageTitle: 'Reference held', rowLabel: entry.ref, sources: [`https://images.shulcloud.com/14396/${entry.sourceId}.mp3`], reason: 'App canonicalReadingRef rejects the source reference' }); return false;
  });
  Object.assign(result.summary, { verifiedOrdinaryReferences: result.recordings.length, torah: result.recordings.filter(r => r.kind === 'torah').length, haftarah: result.recordings.filter(r => r.kind === 'haftarah').length, deferredRows: result.deferred.length });
  const items = [...result.variants, ...result.conflicts.map(r => ({ ...r, category: 'source-conflict' })), ...result.deferred].map(row => {
    const sources = row.sources ?? [`https://images.shulcloud.com/14396/${row.sourceId}.mp3`];
    const recordings = sources.flatMap(url => { const id = audioId(url), media = checkpoint.media[id]; return media?.status === 'verified' ? [{ sourceId: Number(id), sha256: media.sha256, duration: media.duration, bytes: media.bytes, mimeType: media.mimeType ?? 'audio/mpeg' }] : []; });
    return { id: 'sr_' + digest(row.pageUrl + '\n' + row.rowLabel).slice(0, 32), category: row.category, title: row.pageTitle, label: row.rowLabel, pageUrl: row.pageUrl,
      ...(row.ref ? { ref: row.ref, kind: row.kind } : {}), recordings, status: recordings.length ? 'available' : sources.length ? 'pending' : 'missing', ...(row.reason ? { reason: row.reason } : {}) };
  });
  await saveJson(join(root, 'public-verse-manifest.json'), { version: 1, recordings: result.recordings });
  await saveJson(join(root, 'mapped-inventory.json'), result);
  await saveJson(join(root, 'nonverse-catalog.json'), { version: 1, items });
  return result.summary;
}

export async function watchCollection(directory) {
  const root = await outputRoot(directory); let last = '';
  while (true) {
    const next = await readJson(join(root, 'inventory.json'), { version: 1, pages: [] });
    const version = digest(JSON.stringify(next));
    const changed = version !== last;
    if (changed) {
      console.log(JSON.stringify({ event: 'inventory-changed', pages: next.pages.length })); last = version;
    }
    if (next.pages.length) {
      const batch = await acquireCollection(root, 100, true);
      const summary = await generateManifest(root);
      if (batch.attempted || changed) console.log(JSON.stringify({ event: 'coverage', ...summary }));
    }
    await new Promise(yes => setTimeout(yes, 5000));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, directory, count] = process.argv.slice(2);
  if (command === 'serve') await serveInventory(directory, count ? Number(count) : 43121);
  else if (command === 'acquire') await acquireCollection(directory, count ? Number(count) : 100);
  else if (command === 'manifest') console.log(JSON.stringify(await generateManifest(directory)));
  else if (command === 'watch') await watchCollection(directory);
  else throw new Error('Usage: shermet-collection.mjs serve|acquire|manifest|watch <outside-git-directory> [port|batch-size]');
}
