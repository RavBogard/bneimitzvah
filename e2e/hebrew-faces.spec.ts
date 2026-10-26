import { expect, test } from "@playwright/test";

// 1.9 N8: the reading text is Taamey Frank CLM, served as a Hebrew WOFF2 subset. A reader must be able to tell a qamats qatan (U+05C7, an "o"
// sound) from a qamats (U+05B8, an "a" sound), so the two have to paint differently in the served face. The page is the public trope chart,
// which loads the face through the same stylesheet as the reading text; the words are drawn on a canvas in that face and compared pixel by pixel.
const WORDS = { qatan: "חׇכְמָה", qamats: "חָכְמָה" }; // chokhmah: the first vowel is a qamats qatan

test("a qamats qatan paints differently from a qamats in the served Taamey Frank face", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "the glyphs do not depend on the viewport");
  const served: string[] = [];
  page.on("response", response => { if (response.url().includes("/fonts/")) served.push(new URL(response.url()).pathname); });
  await page.goto("/trope-chart");
  const result = await page.evaluate(async words => {
    const face = '400 120px "CRC Taamey Frank"';
    const loaded = await document.fonts.load(face, words.qatan);
    const paint = (text: string) => {
      const canvas = document.createElement("canvas"); canvas.width = 700; canvas.height = 260;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#fff"; context.fillRect(0, 0, 700, 260);
      context.fillStyle = "#000"; context.font = face; context.direction = "rtl"; context.textAlign = "right";
      context.fillText(text, 680, 170);
      return context.getImageData(0, 0, 700, 260).data;
    };
    const qatan = paint(words.qatan), qamats = paint(words.qamats);
    let different = 0;
    for (let at = 0; at < qatan.length; at += 4) if (qatan[at] !== qamats[at]) different += 1;
    let ink = 0;
    for (let at = 0; at < qatan.length; at += 4) if (qatan[at] < 128) ink += 1;
    return { loaded: loaded.length > 0 && loaded.every(font => font.status === "loaded"), different, ink };
  }, WORDS);
  expect(result.loaded).toBe(true);
  expect(result.ink, "the word painted").toBeGreaterThan(2000);
  // The qatan's stem is about 15% longer: a clear number of pixels, never a rounding difference.
  expect(result.different).toBeGreaterThan(40);
  expect(served.filter(path => path.endsWith("TaameyFrankCLM-hebrew.woff2"))).not.toHaveLength(0);
  expect(served.some(path => path.endsWith(".ttf")), "the full TTF is never served to a page").toBe(false);
});
