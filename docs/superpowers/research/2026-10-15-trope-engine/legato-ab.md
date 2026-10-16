# Legato and enunciation A/B for the SoulX renderer (2026-10-15, interrupted)

Daniel on `renders/vocalset-d3/i-samuel-20-18-19-full.wav`: "the consonants aren't always enunciated totally and
clearly, and it sounds super computer-ey rather than smooth and connected." This A/B tests emitter changes
against that, with objective proxies because nobody here can listen. It was stopped part way (the work moves to
the RTX 4070 laptop); the numbers below are everything measured, and the last section is what to run next.

## What SoulX itself does (read from the clone at 81aeb3ae)

- **Word gaps are off-distribution.** SoulX's MIDI path merges any gap under 0.2 s into the previous note
  (`preprocess/tools/midi_parser.py`, `SILENCE_THRESHOLD_SEC = 0.2`). Our 0.1 s `<SP>` after every word is a
  rest length the model hardly saw.
- **English is one token per word, slurs repeat it.** `example/audio/en_target.json`:
  `en_B-Y-UW1-T-AH0-F-AH0-L` type 2 then the same token type 3. So repeating the whole token on slur notes
  (our melismas) is SoulX's convention, and codas are placed by the model at the end of the token's notes.
  Inside a note the data processor tiles the token's phones cyclically over the frames (`<BOW> P1 P2 .. <SEP>
  <EOW>`), so the model learns the alignment itself.
- **Score control ignores f0; melody control ignores note_pitch.** `SoulXSinger.infer`: under `control="score"`
  f0 is replaced by zeros; under `"melody"` note_pitch is zeros and the f0 track drives pitch. A synthetic f0
  with portamento and vibrato is therefore only usable with melody control (`--f0 synth` switches it).
- **Knobs:** `infer.n_steps` 32 (flow-matching steps) and `infer.cfg` 3 (guidance) in `soulxsinger.yaml`; no
  temperature or seed (each render differs). `pitch_shift` / `auto_shift` exist but are not quality knobs.

## The options built (trope/soulx.mjs, scripts/trope-render.mjs; defaults = the old emitter, `--style v1`)

| Flag | Values | What it does |
|---|---|---|
| `--phrasing` | `words` (old) / `phrases` | `phrases`: no rest between words; 0.35 s after etnachta/silluq, 0.2 s after zakef/segol/tipcha only after 3 s of continuous singing |
| `--rhythm` | `grid` (old) / `speech` | deterministic factors: tonic single notes x1.3, sheva/hataf x0.6, open unstressed x0.85, uneven melisma inner notes, cadence ritard; held notes not stretched |
| `--stress` | `lexical` (old) / `full` / `flat` | `full`: unstressed full vowels digit 2, tonic 1; `flat`: all full vowels 1; sheva na and hataf keep 0 |
| `--tokens` | `syllable` (old) / `word` | `word`: one en_ token per maqaf chain, note_type 3 on all its later notes (SoulX's convention) |
| `--f0` | `zeros` (old) / `synth` | raised-cosine 80 ms glides, 5.5 Hz +/-25 cent vibrato on notes >= 0.4 s, unvoiced over voiceless onsets/codas; selects melody control |
| `--steps`, `--cfg` | int / number | override n_steps (32) and cfg (3) |
| `--post` | flag | per verse: -18 LUFS, then a peak limiter at -1 dBFS |
| `--style` | `v1` / `v2` | named sets (`SOULX_STYLES`); `v2` = `--phrasing phrases` only (the winner so far); default is still v1 |

Metrics: `trope/env/pitch_check.py` (pyin, notes within 0.5 st), `trope/gap_check.py` (silent runs >= 50 ms
inside phrases, i.e. not overlapping a planned rest of >= 150 ms; -35 dB relative to the verse's 95th
percentile frame), `trope/asr_cer.py` (ivrit-ai/whisper-large-v3-turbo-ct2 on CPU, language "he", against the
unpointed MAM text: `cer` letters, `skel` letters without ו/י because the ASR writes plene spelling, `wer`).

## Results: I Samuel 20:18-19, key D3, prompt vocalset-m6-dona, GTX 1660 Ti

| Variant | Flags | Pitch within 0.5 st | Gaps inside phrases | CER | skel | WER | Render wall |
|---|---|---|---|---|---|---|---|
| baseline (Daniel's file) | v1 | 91/91 (earlier run) | 18 (1.36 s), peak 0.0 dBFS | 0.183 | 0.130 | 0.458 | 288 s |
| baseline re-render | `--style v1` | 91/91 | 8 (0.64 s) | 0.237 | 0.195 | 0.583 | 292 s |
| **legato** | `--phrasing phrases` | 90/91 | 6 (0.37 s) | **0.140** | **0.117** | **0.375** | 311 s |
| legato-rhythm | `+ --rhythm speech` | 91/91 | 7 (0.46 s) | 0.215 | 0.195 | 0.625 | 310 s |
| legato-rhythm-stressfull | `+ --stress full` | 90/91 | 5 (0.31 s) | 0.215 | 0.130 | 0.500 | 320 s |
| legato-rhythm-stressflat | `+ --stress flat` | killed mid-render (handover) | | | | | |
| not run | `--tokens word`, `--f0 synth`, `--steps 64`, prompts, `--post` | | | | | | |

Run-to-run noise is large: the same v1 settings gave CER 0.183 and 0.237 on two renders (2 verses, ~120
letters). Differences under ~0.06 CER are noise at this sample size.

Transcripts (ASR output) show the mechanisms better than the totals:
- baseline: `ונפקדת` -> `במפקדך`; 20:19 `תרד` -> `את הרעין`, `המעשה` -> `המר עשה` (word split at a word gap).
- legato: `ושילשת תרד מאוד ובאת אל המקום אשר נסתרת שם ביום המעשה וישבת את סוף האבן הזה` (20:19 CER 0.14): the
  word-internal splits are gone.
- rhythm speech: `ונפקדת` -> `ומפקד אתה` (the lengthened post-tonic `ta` heard as a word), `יהונתן` -> `יונתן`
  (the shortened unstressed `ho` swallowed). The factors are probably too strong for unstressed open syllables.
- stress full: `מחר` -> `מוהר`, `המעשה` -> `המועשה`: digit-2 vowels drift (AA2 heard as o). But `skel` stayed
  0.130 and gaps were lowest.

## Verdict so far

- **Won: `--phrasing phrases`.** Best CER/WER of everything run, fewer silent gaps, pitch unchanged. It removes
  exactly the off-distribution 0.1 s word rests. This is the one change to make default now.
- **Not shown to help (on 2 verses): `--rhythm speech`, `--stress full`.** Both within noise or worse, with
  plausible failure mechanisms in the transcripts. Keep them as options; retest on 6+ verses, and try a milder
  rhythm (unstressed open 0.95, tonic 1.15) before dropping it.
- **Untested:** `--stress flat`, `--tokens word`, `--f0 synth` (melody control), `--steps 64`, `--cfg`,
  `--post`, prompts.
- **Prompts prepared (in `$HAFTARAH_AUDIO/prompts/`, not in git):** `vocalset-m6-rowfix` (VocalSet m6 "Row your
  boat", English, tokens hand-corrected per note against the detected pitches: ROSVOT's word grouping had put
  "the" on the 1.7 s "stream" note and misassigned "merrily"), and `vocalset-m6-donarow` (dona + rowfix joined
  into one 33.3 s segment; SoulX reads only the first segment, so it must be one). To rebuild rowfix: run
  `scripts/trope-prompt.mjs --in <VocalSet>/male6/excerpts/straight/m6_row_straight.wav --name vocalset-m6-row
  --lyric "row row row your boat gently down the stream merrily merrily merrily merrily life is but a dream"`,
  then set the 30 phoneme/note_type entries to: SP, row x3, your, boat, SP, gently (2,3), down, the, stream, SP,
  merrily (2,3,3), merrily (2,3,3,3), merrily, SP, merrily, life (2,3), is, but, a, dream, SP.

## Next, in this order (each 2-verse run ~5 min here, faster on the 4070)

1. Make the sample bigger: run each finalist on `REF="I Samuel 20:18-23"` (6 verses) so CER differences mean
   something: v1, `--phrasing phrases`, phrases + `--stress flat`, phrases + `--stress full`.
2. On the winner: `--tokens word`, `--f0 synth`, `--steps 64`, `--cfg 2` and `--cfg 4`, one at a time.
3. Prompts on the winner: `PROMPT=$HAFTARAH_AUDIO/prompts/vocalset-m6-rowfix` and `.../vocalset-m6-donarow`.
4. Set `SOULX_STYLES.v2` to the winning set and `DEFAULT_STYLE = "v2"` in `trope/render-cli.mjs`; add `--post`
   (peaks currently reach 0.0 dBFS on 20:19); render 20:18-19 into `renders/ab/best/` and the whole Machar
   Chodesh into `renders/machar-chodesh-v2/`.

## Reproduce on another machine

```bash
# audio folder: $HAFTARAH_AUDIO, default ~/haftarah-audio (soulx-env/ per trope/env/soulx-env-README.md)
cd ~/haftarah-audio && py -3.12 -m venv asr-env            # Linux/mac: python3.12 -m venv asr-env
./asr-env/Scripts/python -m pip install faster-whisper soundfile numpy scipy
# (first asr_cer.py run downloads ivrit-ai/whisper-large-v3-turbo-ct2, ~1.6 GB, into the HF cache)
cd <repo>
bash trope/env/ab/run_ab.sh baseline --style v1
bash trope/env/ab/run_ab.sh legato --phrasing phrases
REF="I Samuel 20:18-23" bash trope/env/ab/run_ab.sh legato6 --phrasing phrases
PROMPT=$HAFTARAH_AUDIO/prompts/vocalset-m6-rowfix bash trope/env/ab/run_ab.sh legato-row --phrasing phrases
```

`asr_cer.py` reads audio with soundfile (faster-whisper's PyAV decoder failed with this PyAV build) and must run
with `-I` in its own venv; the reference text is `trope/env/ab/ref-text-i-samuel-20-18-42.json` (whole Machar
Chodesh, unpointed, fetched from Sefaria MAM).
