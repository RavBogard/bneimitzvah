import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkPromptMeta, tokenPhones, promptArgv, parsePromptCli, promptName, noteName, F0_FPS } from "../trope/prompt.mjs";

const phoneSet = new Set(JSON.parse(readFileSync(new URL("./fixtures/trope/soulx-phone-set.json", import.meta.url), "utf8")).tokens);

// A small well-formed prompt in the shape trope/soulx_prompt.py writes: rest, "Do-na" (na slurred over
// two notes), rest. 2.00 s of notes, so 100 f0 frames.
const seg = (over = {}) => ({
  index: "t", language: "English", time: [0, 2000],
  duration: "0.20 0.60 0.50 0.40 0.30",
  text: "<SP> en_D-OW1 en_N-AA0 en_N-AA0 <SP>",
  phoneme: "<SP> en_D-OW1 en_N-AA0 en_N-AA0 <SP>",
  note_pitch: "0 53 48 57 0",
  note_type: "1 2 2 3 1",
  f0: [...Array(10).fill("0.0"), ...Array(80).fill("174.6"), ...Array(10).fill("0.0")].join(" "),
  ...over,
});

test("a well-formed prompt passes and is summarised", () => {
  const { errors, warnings, summary } = checkPromptMeta([seg()], { phoneSet });
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, ["2 s is short for a prompt (aim for 5-30 s)"]);
  assert.deepEqual(summary, { seconds: 2, notes: 3, rests: 2, words: 2, pitchRange: [48, 57], pitchNames: ["C3", "A3"], f0Frames: 100, voicedFraction: 0.8 });
  assert.equal(F0_FPS, 50);
});

test("structural errors are caught before a render", () => {
  assert.match(checkPromptMeta([], {}).errors[0], /non-empty list/);
  assert.match(checkPromptMeta([seg({ phoneme: undefined })]).errors[0], /no "phoneme"/);
  assert.match(checkPromptMeta([seg({ note_pitch: "0 53 48 0" })]).errors[0], /"note_pitch" has 4 entries, "phoneme" has 5/);
  const e = checkPromptMeta([seg({ note_pitch: "0 0 48 57 0", note_type: "1 2 1 3 4", duration: "0.20 0 0.50 0.40 0.30" })]).errors;
  assert.ok(e.some(x => /note 1: duration 0/.test(x)));
  assert.ok(e.some(x => /note 1: sung token en_D-OW1 with pitch 0/.test(x)));
  assert.ok(e.some(x => /note 2: sung token en_N-AA0 with note_type 1/.test(x)));
  assert.ok(e.some(x => /note 4: note_type 4/.test(x)));
});

test("tokens are checked phone by phone against SoulX's phone set", () => {
  assert.deepEqual(tokenPhones("en_W-IH1-SH"), ["en_W", "en_IH1", "en_SH"]);
  assert.deepEqual(tokenPhones("zh_ha1"), ["zh_ha1"]);
  assert.deepEqual(tokenPhones("<SP>"), []);
  const bad = checkPromptMeta([seg({ phoneme: "<SP> en_D-OW1 en_N-AA9 en_N-AA9 <SP>" })], { phoneSet });
  assert.deepEqual(bad.errors, ["not in SoulX's phone set: en_AA9"]);
  // Without a phone set the token check is skipped, not failed.
  assert.deepEqual(checkPromptMeta([seg({ phoneme: "<SP> en_D-OW1 en_N-AA9 en_N-AA9 <SP>" })]).errors, []);
});

test("warnings: extra segments, f0 length, slur continuity, missing f0, length", () => {
  const w = m => checkPromptMeta(m, { phoneSet }).warnings;
  assert.ok(w([seg(), seg()]).some(x => /only the first/.test(x)));
  assert.ok(w([seg({ f0: Array(90).fill("100").join(" ") })]).some(x => /f0 has 90 frames, durations add up to 100/.test(x)));
  assert.ok(w([seg({ note_type: "1 2 3 3 1" })]).some(x => /note 2: slur/.test(x)));
  assert.ok(w([seg({ f0: "" })]).some(x => /no f0/.test(x)));
  const long = seg({ duration: "0.20 20.60 10.50 0.40 0.30", f0: Array(1600).fill("100").join(" ") });
  assert.ok(w([long]).some(x => /32 s is long/.test(x)));
});

test("CLI options map onto soulx_prompt.py flags", () => {
  const opts = parsePromptCli(["--in", "a.wav", "--name", "p", "--out-dir", "o", "--tokens", "en_D-OW1 en_N-AA0", "--start", "1.5", "--no-trim"]);
  assert.deepEqual(opts, { in: "a.wav", name: "p", outDir: "o", tokens: "en_D-OW1 en_N-AA0", start: "1.5", "no-trim": true });
  const argv = promptArgv(opts, { script: "s.py", repo: "R", models: "M" });
  assert.deepEqual(argv, ["s.py", "--in", "a.wav", "--out-dir", "o", "--name", "p", "--repo", "R", "--models", "M", "--device", "cpu",
    "--tokens", "en_D-OW1 en_N-AA0", "--start", "1.5", "--no-trim"]);
  assert.equal(promptArgv({ ...opts, gpu: true }, { script: "s.py", repo: "R", models: "M" })[12], "cuda");
  assert.throws(() => parsePromptCli(["--lyrics", "x"]), /unknown option --lyrics/);
  assert.throws(() => parsePromptCli(["--in"]), /--in needs a value/);
  assert.throws(() => promptArgv({ in: "a", name: "b", lyric: "x", tokens: "y" }, {}), /alternatives/);
  assert.throws(() => promptArgv({ name: "b" }, {}), /--in/);
});

test("names", () => {
  assert.equal(promptName("C:\\x\\FULL\\male6\\m6_dona_straight.wav"), "m6-dona-straight");
  assert.equal(promptName("/tmp/Daniel Take 2.WAV"), "daniel-take-2");
  assert.equal(noteName(50), "D3");
  assert.equal(noteName(61), "C#4");
});
