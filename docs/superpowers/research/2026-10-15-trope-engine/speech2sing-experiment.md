# Speech-to-singing experiment (voice-quality.md path 1), status 2026-10-15

**Status: stages (a) and (b) work and were measured. Stage (c), the SoulX-Singer-SVC sung output, was NOT run.**
The GTX 1660 Ti was busy with the other agent's A/B renders the whole session. One attempt collided with a job that started 4 s later and was killed at once. The CPU fallback render was abandoned when the work moved to the RTX 4070 laptop. Nobody has listened to any of it yet.

## What each stage does

| Stage | Code | What it does |
|---|---|---|
| plan | `trope/speech2sing.mjs` (`buildPlan`, `scoreF0`) | Takes the score (`scoreVerse`, key D3) plus its SoulX v2 note timeline (`scoreToSoulx`, `SOULX_STYLES.v2`: legato, speech rhythm, breaths at etnachta, sof pasuk and long tipcha runs). It splits the verse into phrases at those breaths. For each syllable it gives our own phonemes as Phonikud IPA (χ ʁ ʃ ts, ascii g; a geminate coda is dropped, as modern speech does), the stress mark (the tonic, else a secondary accent, else dictionary stress), the vowel onset time (which is the note onset) and the syllable's total note time. It also builds the score f0 at 50 fps: 80 ms raised-cosine glides, light vibrato on long notes, and a 200 ms lead-in before each phrase for its onset consonant. |
| (a) raw TTS | `trope/speech2sing.py` | The Phonikud-TTS `michael` voice (Piper/VITS ONNX, CPU, about 1 s per verse) speaks each phrase from those phonemes. Output: `01-raw-tts.wav`. |
| (b) timed speech | same | **The durations are set inside the TTS, not stretched afterwards.** On first run the script derives two graphs from the voice: `*.dur-v2.onnx` also outputs the duration predictor's `w_ceil` (frames per input id), and `*.timed-v2.onnx` takes `w_ceil` as an input in place of its `/Ceil` node. Both have seeded noise nodes, so a render repeats exactly. The timing rule: the vowel starts on the note. Between two vowel onsets sit vowel k, its coda and the next syllable's onset. The consonants keep their spoken length (capped at 60% of the span) and the vowel gets the rest, so the decoder generates long vowels. Every syllable boundary is known to the frame, so no forced aligner is needed. Output: `02-timed-speech.wav` (and `-24k`). Two comparison files are written too: `02-world-stretch.wav` (the raw take time-warped by WORLD to the same frames, the after-the-fact alternative) and `02-world-pitched.wav` (the timed speech with the score f0 forced on by WORLD; this is the DSP baseline and the pitch-carrying source Seed-VC needs). |
| f0 | same | `target_f0.npy` is the plan's score f0, zeroed over voiceless consonants (known from the imposed frames) and over silence. `prompt_f0.npy` comes from the prompt's SoulX metadata. |
| (c) SVC | `trope/soulx_svc_runner.py` | SoulX-Singer-SVC (`model-svc.pt`) re-sings `02-timed-speech-24k.wav` with `target_f0.npy` and the prompt `prompts/vocalset-m6-dona.wav`: no auto shift, 32 steps, cfg 3, fp16 on CUDA. It runs in the existing soulx-env. A CPU smoke test (2 steps, 4 s clip) ran end to end: 15 s to load the model, 25 s to render. **The full render was not done.** With `--cpu` the runner hides the GPU with `CUDA_VISIBLE_DEVICES=-1`, because SoulX's Whisper encoder otherwise moves itself to CUDA. An empty value does not work on Windows, which drops empty variables. |
| check | `trope/s2s_pitch.py` | Runs pyin over each note and compares it with the plan (within ±0.5 semitone), and reports the share of 20 ms frames under -45 dBFS inside phrases. |
| driver | `scripts/trope-speech2sing.mjs` | Takes `--stage tts\|svc\|all` and `--source timed\|world`, and writes `manifest.json` (the sung WAV per verse) for `trope/asr_cer.py`. Tests: `tests/trope-speech2sing.test.mjs` (8 tests). |

## Numbers so far

I Samuel 20:18-19, CER from ivrit-ai whisper-large-v3-turbo via `trope/asr_cer.py`:

| File | 20:18 CER | 20:19 CER | Pooled CER / skeleton CER |
|---|---|---|---|
| SoulX ARPAbet render `renders/vocalset-d3/01-i-samuel-20-18.wav` (v1 style) | 0.111 | not run | - |
| 01 raw TTS (michael, noise 0.333, seeded) | 0.167 | 0.088 | 0.118 / 0.078 |
| 02 timed speech | 0.194 | 0.105 | 0.140 / 0.104 |
| 02 WORLD stretch | 0.194 | 0.088 | 0.129 / 0.091 |
| 02 WORLD pitched | 0.167 | 0.088 | 0.118 / 0.078 |

Voice and noise sweep on 20:18 (raw / timed CER, unseeded takes):

| Voice | Noise 0.667 | Noise 0.333 |
|---|---|---|
| michael | 0.194 / 0.167 | **0.083 / 0.083** |
| shaul | 0.194 / 0.167 | 0.139 / 0.167 |

So 0.333 is the default noise setting. Single-verse ASR scores move by about ±0.08 between takes, so treat all of these as noisy.

- **Recurring errors.** The phrase-initial m of מחר is heard as אחר, and the held final syllable of מושבך is often misheard.
- **Cost of the long durations.** Imposing durations 2-3 times longer than spoken costs little intelligibility: about +0.02 pooled CER from raw to timed.
- **Gaps.** In the timed speech, 13.6% (20:18) and 15.3% (20:19) of in-phrase frames are under -45 dBFS, mostly stop closures. No SoulX baseline has been measured for this yet.
- **Pitch.** The speech stages carry speech pitch by design. The melody comes only from the SVC's f0 input.

## Listening order (once stage (c) exists)

1. In `renders/s2s/01-i-samuel-20-18/`: 01-raw-tts, then 02-timed-speech, then 02-world-pitched (the DSP baseline), then 03-sung-svc.
2. Compare 03-sung-svc against `renders/vocalset-d3/01-i-samuel-20-18.wav`.
3. Then render with `--source world` and listen to 03-sung-svc-world.

## Not done

- The SVC sung output, and its pitch check and CER.
- Seed-VC singing mode. The repo is cloned to `haftarah-audio/seedvc-env/seed-vc` (commit 51383ef), but it has no venv yet. Its f0 model tracks the source's pitch, so feed it `02-world-pitched.wav`.

## Setup on a fresh machine, and commands

See `docs/superpowers/plans/2026-10-15-trope-home-setup.md`, section "5. Speech-to-singing". Licence: the Phonikud-TTS checkpoints are non-commercial. Daniel accepted that for an intermediate stage, since SVC replaces its voice.
