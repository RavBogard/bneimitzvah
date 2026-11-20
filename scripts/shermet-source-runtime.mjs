// Compile the app's pure canonical-reference implementation outside Git, so
// import tooling uses the same corpus bounds and Roman book names as playback.
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function loadCanonicalReading(directory) {
  const names = ['reading-ref.ts', 'catalog.ts', 'commentary.ts', 'ranges.ts', 'leyning.mjs'];
  const source = await Promise.all(names.map(name => readFile(new URL(`../src/lib/readings/${name}`, import.meta.url), 'utf8')));
  const key = createHash('sha256').update(source.join('\n')).digest('hex');
  const root = join(directory, 'source-runtime', key); await mkdir(root, { recursive: true });
  for (const [i, name] of names.entries()) {
    let text = name.endsWith('.ts') ? stripTypeScriptTypes(source[i], { mode: 'transform' }) : source[i];
    text = text.replace(/from (["'])\.\/(reading-ref|catalog|commentary|ranges)(?:\.ts)?\1/g, (_, quote, module) => `from ${quote}./${module}.mjs${quote}`);
    await writeFile(join(root, name.replace(/\.ts$/, '.mjs')), text);
  }
  return { ...(await import(pathToFileURL(join(root, 'reading-ref.mjs')).href)), ...(await import(pathToFileURL(join(root, 'catalog.mjs')).href)), sourceDirectory: root };
}

export async function loadTimingParser(directory) {
  const canonical = await loadCanonicalReading(directory);
  const source = await readFile(new URL('../src/lib/reference-audio/shermet-timing.ts', import.meta.url), 'utf8');
  const code = stripTypeScriptTypes(source, { mode: 'transform' }).replace(/from ["']\.\.\/readings\/reading-ref["']/g, `from ${JSON.stringify(pathToFileURL(join(canonical.sourceDirectory, 'reading-ref.mjs')).href)}`);
  const path = join(canonical.sourceDirectory, 'shermet-timing.mjs'); await writeFile(path, code);
  return import(pathToFileURL(path).href);
}

export async function loadHebrewProjection(directory) {
  const normalize = await readFile(new URL('../src/server/study/normalize.ts', import.meta.url), 'utf8');
  const project = await readFile(new URL('../src/lib/hebrew/study-tokens.ts', import.meta.url), 'utf8');
  const key = createHash('sha256').update(normalize + project).digest('hex');
  const root = join(directory, 'projection-runtime', key); await mkdir(root, { recursive: true });
  const normalizer = stripTypeScriptTypes(normalize.replace(/^import ["']server-only["'];\r?\n/m, ''), { mode: 'transform' }).replace(/from ["']parse5["']/g, `from ${JSON.stringify(import.meta.resolve('parse5'))}`);
  await writeFile(join(root, 'normalize.mjs'), normalizer);
  await writeFile(join(root, 'study-tokens.mjs'), stripTypeScriptTypes(project, { mode: 'transform' }));
  return { ...(await import(pathToFileURL(join(root, 'normalize.mjs')).href)), ...(await import(pathToFileURL(join(root, 'study-tokens.mjs')).href)), sourceRuntimeSha256: key };
}
