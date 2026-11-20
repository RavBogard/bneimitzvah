// Cache source text only outside Git, and bind timings to the app's current projection.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { insideGitWorkingTree } from './private-paths.mjs';
import { loadHebrewProjection } from './shermet-source-runtime.mjs';

export async function prepareProjection(inventoryFile, priorChapters, outputDirectory) {
  if (await insideGitWorkingTree(outputDirectory)) throw new Error('Text projections must stay outside Git');
  const root = resolve(outputDirectory), cache = join(root, 'mam-chapters'); await mkdir(cache, { recursive: true });
  const { normalizeHebrew, projectStudyVerse, sourceRuntimeSha256 } = await loadHebrewProjection(root);
  const inventory = JSON.parse((await readFile(inventoryFile, 'utf8')).replace(/^\uFEFF/, ''));
  const refs = [...new Set((inventory.provenance ?? inventory.recordings ?? []).map(r => r.ref).filter(Boolean))];
  const chapters = [...new Set(refs.map(ref => ref.replace(/:\d+$/, '')))];
  const verses = {}, holds = [];
  for (const chapter of chapters) {
    const file = chapter.replace(/ /g, '_') + '.json'; let source;
    for (const directory of [cache, priorChapters]) {
      try { source = JSON.parse((await readFile(join(directory, file), 'utf8')).replace(/^\uFEFF/, '')); break; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (!source) {
      const url = new URL(`https://www.sefaria.org/api/v3/texts/${encodeURIComponent(chapter)}`);
      url.searchParams.set('version', 'hebrew|Miqra according to the Masorah'); url.searchParams.set('return_format', 'default');
      const response = await fetch(url, { redirect: 'error', headers: { accept: 'application/json', 'user-agent': 'CRC-Torah/1.4 (+https://torah.centralreform.org)' }, signal: AbortSignal.timeout(30000) });
      if (!response.ok) { holds.push({ chapter, reason: `MAM request HTTP ${response.status}` }); continue; }
      const payload = await response.json(), edition = payload.versions?.find(v => v.versionTitle === 'Miqra according to the Masorah' && v.languageFamilyName === 'hebrew');
      if (!edition || !Array.isArray(edition.text) || edition.text.some(v => typeof v !== 'string')) { holds.push({ chapter, reason: 'Missing exact MAM chapter edition' }); continue; }
      source = { ref: chapter, versionTitle: edition.versionTitle, license: edition.license, text: edition.text, fetchedAt: new Date().toISOString(), sourceUrl: url.href };
      await writeFile(join(cache, file), JSON.stringify(source));
      await new Promise(yes => setTimeout(yes, 250));
    }
    if (source.versionTitle !== 'Miqra according to the Masorah' || !Array.isArray(source.text)) { holds.push({ chapter, reason: 'Unexpected cached source edition' }); continue; }
    for (const ref of refs.filter(ref => ref.startsWith(chapter + ':'))) {
      try {
        const hebrew = normalizeHebrew(source.text[Number(ref.split(':').at(-1)) - 1]);
        const projected = projectStudyVerse(ref, hebrew);
        if (projected.status !== 'ready') throw new Error(`Projection ${projected.reason}`);
        verses[ref] = { status: 'ready', readingText: projected.projection.readingText, words: projected.projection.words.map(w => w.text) };
      } catch (error) { holds.push({ ref, reason: String(error.message) }); }
    }
  }
  await writeFile(join(root, 'portal-words-current.json'), JSON.stringify({ sourceRuntimeSha256, verses }));
  await writeFile(join(root, 'projection-holds.json'), JSON.stringify(holds, null, 2));
  return { requested: refs.length, projected: Object.keys(verses).length, holds: holds.length, chapters: chapters.length, sourceRuntimeSha256 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await prepareProjection(...process.argv.slice(2))));
}
