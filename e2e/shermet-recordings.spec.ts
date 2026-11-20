import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { projectStudyVerse } from '../src/lib/hebrew/study-tokens';
import { syntheticCourseRoutes, syntheticWords } from './learn-synthetic';
import { mockVayera, verseOf } from './aliyot-fixture';

// Synthetic silent PCM only: no human audio or scripture enters the browser fixtures.
function syntheticAudio() {
  const frames = 8000 * 30, data = Buffer.alloc(44 + frames * 2);
  data.write('RIFF'); data.writeUInt32LE(36 + frames * 2, 4); data.write('WAVE', 8);
  data.write('fmt ', 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(8000, 24); data.writeUInt32LE(16000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(frames * 2, 40); return data;
}

for (const [kind, ref] of [['torah', 'Exodus 35:1'], ['haftarah', 'Micah 7:18']] as const) {
  test(`public ${kind} uses Shermet on the first tap, repeats and switches recordings`, async ({ page }) => {
    // Existing arbitrary-ref reader fixture deliberately reports PocketTorah unavailable.
    await mockVayera(page, { mode: 'none' }, { haftarah: true });
    const audio = syntheticAudio(), requested: string[] = [];
    let releaseCatalog!: () => void;
    const catalogGate = new Promise<void>(resolve => { releaseCatalog = resolve; });
    await page.route('**/api/shermet-audio/catalog', async route => {
      await catalogGate;
      await route.fulfill({ json: { refs: [ref] } });
    });
    const projection = projectStudyVerse(ref, verseOf(ref, 0).hebrew);
    if (projection.status !== 'ready') throw new Error('Synthetic projection failed');
    const words = Array.from({ length: projection.projection.words.length }, (_, index) => ({ start: index * 2, end: index * 2 + 1.8 }));
    const sha = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
    await page.route('**/api/shermet-audio/timing?*', route => route.fulfill({ json: { timing: {
      version: 1, status: 'ready', kind, ref, audioSha256: sha(audio), readingTextSha256: sha(projection.projection.readingText.normalize('NFC')),
      wordCount: words.length, duration: 30, words,
    } } }));
    await page.route('**/api/shermet-audio?*', route => {
      requested.push(new URL(route.request().url()).searchParams.get('ref')!);
      const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? '');
      const first = range ? Number(range[1]) : 0, last = range?.[2] ? Math.min(Number(range[2]), audio.length - 1) : audio.length - 1;
      const headers: Record<string, string> = { 'accept-ranges': 'bytes', 'content-length': String(last - first + 1) };
      if (range) headers['content-range'] = `bytes ${first}-${last}/${audio.length}`;
      return route.fulfill({ status: range ? 206 : 200, contentType: 'audio/wav', headers, body: audio.subarray(first, last + 1) });
    });
    await page.addInitScript(() => {
      const target = window as unknown as { shermetPlays: number; shermetAudio: HTMLMediaElement | null };
      target.shermetPlays = 0; target.shermetAudio = null;
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        if (this.src.includes('/api/shermet-audio?')) { target.shermetPlays++; target.shermetAudio = this; }
        return play.call(this);
      };
    });
    await page.goto(`/read?${new URLSearchParams({ ref, kind })}`);
    const row = page.locator(`.study-verses [data-verse-ref="${ref}"]`).first();
    await expect(row).toBeVisible();
    const player = page.getByRole('region', { name: 'Reading playback', exact: true });
    const source = player.getByRole('combobox', { name: 'Recording', exact: true });
    expect(requested).toEqual([]); // Metadata discovery must not prefetch a human recording.
    await row.locator('[data-word-index="0"]').first().click();
    releaseCatalog();
    await expect(source).toHaveValue('shermet');
    await expect(player.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await expect(player.getByTestId('player-selection')).toHaveAttribute('data-selected-ref', ref);
    await expect(player.getByRole('combobox', { name: 'Practice', exact: true })).toHaveValue('verse');
    const rate = () => page.evaluate(() => (window as unknown as { shermetAudio: HTMLMediaElement }).shermetAudio.playbackRate);
    const speed = player.getByRole('combobox', { name: 'Speed', exact: true });
    await expect.poll(rate).toBe(1.25);
    await speed.selectOption('0.75'); await expect.poll(rate).toBe(0.9375);
    await speed.selectOption('1.25'); await expect.poll(rate).toBe(1.5625);
    expect(await page.evaluate(() => (window as unknown as { shermetAudio: HTMLMediaElement }).shermetAudio.preservesPitch)).toBe(true);
    // Native time, not wall time or a scaled boundary, determines the active word.
    await page.evaluate(() => { (window as unknown as { shermetAudio: HTMLMediaElement }).shermetAudio.currentTime = 4.1; });
    await expect(row.locator('[data-word-index="2"]').first()).toHaveAttribute('data-reference-active', 'true');
    await player.getByText('Recording credit', { exact: true }).click();
    await expect(player.getByRole('link', { name: /Cantor Wendy Shermet.*Temple Israel, Omaha/ })).toBeVisible();
    const repeat = player.getByRole('button', { name: 'Repeat', exact: true });
    await repeat.click(); await expect(repeat).toHaveAttribute('aria-pressed', 'true');
    // Exercise an actual playing loop even if a loaded runner let the fixture
    // finish while opening the credit and choosing Repeat.
    const play = player.getByRole('button', { name: 'Play', exact: true });
    if (await play.isVisible()) await play.click();
    await expect(player.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    const before = await page.evaluate(() => (window as unknown as { shermetPlays: number }).shermetPlays);
    // Seek to the real synthetic media end, exercising its native ended event and replay.
    await page.evaluate(() => { const audio = (window as unknown as { shermetAudio: HTMLMediaElement }).shermetAudio; audio.currentTime = audio.duration - 0.05; });
    await expect.poll(() => page.evaluate(() => (window as unknown as { shermetPlays: number }).shermetPlays)).toBeGreaterThan(before);
    await expect.poll(rate).toBe(1.5625); await expect(speed).toHaveValue('1.25');
    await player.getByRole('button', { name: 'Pause', exact: true }).click();
    await player.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(player.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await source.selectOption('pockettorah');
    await expect(player.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0);
    await source.selectOption('shermet');
    await row.locator('[data-word-index="0"]').first().click();
    await expect(player.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await expect.poll(rate).toBe(1.5625); await expect(speed).toHaveValue('1.25');
    expect(requested.length).toBeGreaterThan(0); expect(requested.every(value => value === ref)).toBe(true);
  });
}

test('Learn speed menus play Shermet faster and slower without completing practice or changing fallback', async ({ page }) => {
  await syntheticCourseRoutes().install(page);
  const audio = syntheticAudio();
  let covered = true;
  await page.route('**/api/shermet-audio/timing?*', route => {
    if (!covered) return route.fulfill({ status: 404 });
    const ref = new URL(route.request().url()).searchParams.get('ref')!;
    const text = syntheticWords(ref, 'torah').join(' ').normalize('NFC');
    const projection = projectStudyVerse(ref, { text, readingText: text, segments: [{ kind: 'text', text }], paragraphAfter: null });
    if (projection.status !== 'ready') throw new Error('Synthetic projection failed');
    const sha = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
    const words = projection.projection.words.map((_, i) => ({ start: i * .4, end: i * .4 + .35 }));
    return route.fulfill({ json: { timing: { version: 1, status: 'ready', kind: 'torah', ref, audioSha256: sha(audio), readingTextSha256: sha(text), wordCount: words.length, duration: 30, words } } });
  });
  await page.route('**/api/shermet-audio?*', route => route.fulfill({ contentType: 'audio/wav', body: audio }));
  await page.addInitScript(() => {
    const target = window as unknown as { courseAudio: HTMLMediaElement };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { if (this.src.startsWith('blob:')) target.courseAudio = this; return play.call(this); };
  });
  const nativeRate = () => page.evaluate(() => (window as unknown as { courseAudio: HTMLMediaElement }).courseAudio.playbackRate);
  await page.goto('/learn/torah-sof-pasuk');
  const hear = page.getByRole('button', { name: 'Hear it', exact: true });
  await hear.click(); await expect(hear).toHaveAttribute('data-state', 'playing');
  await expect.poll(nativeRate).toBe(1.25);
  await hear.click(); await hear.click(); await expect(hear).toHaveAttribute('data-state', 'playing');
  await expect.poll(nativeRate).toBe(1.25);
  const speed = page.getByRole('combobox', { name: 'Model speed', exact: true });
  for (const flow of ['preparation', 'sound']) {
    if (flow === 'preparation') await page.goto('/learn/torah-first-verse');
    else { await page.goto('/learn/torah-sof-pasuk'); await page.getByRole('button', { name: 'Try the sound', exact: true }).click(); }
    await expect(speed).toHaveValue('1');
    const model = page.getByRole('button', { name: flow === 'preparation' ? 'Hear the whole verse' : 'Hear this phrase', exact: true });
    await speed.selectOption('1.25');
    await model.click(); await expect(model).toHaveAttribute('data-state', 'playing');
    await expect.poll(nativeRate).toBe(1.5625);
    await speed.selectOption('0.75');
    await expect(model).toHaveAttribute('data-state', 'idle');
    expect(await page.evaluate(() => (window as unknown as { courseAudio: HTMLMediaElement }).courseAudio.paused)).toBe(true);
    await model.click(); await expect(model).toHaveAttribute('data-state', 'playing');
    await expect.poll(nativeRate).toBe(.9375);
    await page.getByRole('button', { name: flow === 'preparation' ? 'Go straight to a whole-verse attempt' : 'Try this familiar phrase directly', exact: true }).click();
    await expect(speed).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { courseAudio: HTMLMediaElement }).courseAudio.paused)).toBe(true);
    const lessons = await page.evaluate(() => (JSON.parse(localStorage.getItem('crc-torah:learn-progress/v1') ?? '{}') as { lessons?: Record<string, unknown> }).lessons ?? {});
    expect(lessons['torah-first-verse']).toBeUndefined(); expect(lessons['torah-sof-pasuk']).toBeUndefined();
  }
  covered = false;
  await page.reload(); await hear.click(); await expect(hear).toHaveAttribute('data-state', 'playing');
  await expect.poll(nativeRate).toBe(1);
});

test("the public reader plays a full collection track on demand and returns to Wendy for a word tap", async ({ page }) => {
  const ref = "Exodus 35:1";
  await mockVayera(page, { mode: "none" });
  await page.route("**/api/shermet-audio/catalog", route => route.fulfill({ json: { refs: [ref] } }));
  await page.route("**/api/shermet-audio?*", route => route.fulfill({ contentType: "audio/wav", body: syntheticAudio() }));
  await page.route("https://karaites.org/uploads/**", route => route.fulfill({ contentType: "audio/wav", body: syntheticAudio() }));
  await page.goto("/read?" + new URLSearchParams({ ref, kind: "torah" }));
  const reader = page.getByRole("region", { name: "Reading playback", exact: true });
  const wendy = reader.getByRole("combobox", { name: "Recording", exact: true });
  await expect(wendy).toHaveValue("shermet");
  await reader.getByText("Other recorded readings", { exact: true }).click();
  await reader.getByRole("combobox", { name: "Full reading recording" }).selectOption("karaite-vayakhel-torah");
  await expect(reader.getByRole("link", { name: "Hazan Rotem Cohen" })).toBeVisible();
  await expect(reader.getByRole("button", { name: /excerpt/ })).toHaveCount(0);
  const start = reader.getByRole("button", { name: "Play full recording", exact: true });
  await start.click();
  await expect(reader.getByRole("button", { name: "Pause collection recording" })).toBeVisible();
  await page.locator(`.study-verses [data-verse-ref="${ref}"] [data-word-index="0"]`).first().click();
  await expect(reader.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await expect(start).toBeVisible();
  await expect(wendy).toHaveValue("shermet");
  await expect(reader.getByTestId("player-selection")).toHaveAttribute("data-selected-ref", ref);
});

test("both added collections are separately browsable and filterable", async ({ page }) => {
  await page.goto("/recordings");
  const collection = page.getByRole("combobox", { name: "Collection", exact: true });
  await expect(collection).toHaveValue("shermet");
  const search = page.getByRole("searchbox", { name: "Search recordings", exact: true });
  const library = page.getByRole("region", { name: "Recording library", exact: true });
  await collection.selectOption("rotem-cohen");
  await page.getByRole("combobox", { name: "Category", exact: true }).selectOption("haftarah");
  await search.fill("bereshit");
  await expect(library.getByRole("heading", { name: "Hazan Rotem Cohen" })).toBeVisible();
  await expect(library.getByRole("button", { name: /Listen to .*Bereshit/i })).toBeVisible();
  await collection.selectOption("josh-finkel");
  await search.fill("Esther 7:1");
  await expect(library.getByRole("heading", { name: "Cantor Josh Finkel" })).toBeVisible();
  await expect(library.getByRole("button", { name: /Listen to Esther 7:1/ }).first()).toBeVisible();
});
