import { expect, test } from '@playwright/test';
import { mockVayera } from './aliyot-fixture';

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
    await page.route('**/api/shermet-audio/timing?*', route => route.fulfill({ status: 404 }));
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
    await player.getByRole('button', { name: 'Pause', exact: true }).click();
    await player.getByRole('button', { name: 'Play', exact: true }).click();
    await expect(player.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await source.selectOption('pockettorah');
    await expect(player.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0);
    await source.selectOption('shermet');
    await row.locator('[data-word-index="0"]').first().click();
    await expect(player.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    expect(requested.length).toBeGreaterThan(0); expect(requested.every(value => value === ref)).toBe(true);
  });
}
