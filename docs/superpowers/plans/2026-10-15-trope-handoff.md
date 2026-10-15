# Trope engine handoff: office PC -> RTX 4070 laptop (2026-10-15 evening)

Branch `trope-engine-research` (never commit to main; another coder, RavBogard, pushes to main). Commit as
Daniel Bogard <daniel@centralreform.org> (repo-local git config). Push with `git pull --rebase origin
trope-engine-research && git push origin trope-engine-research`; never force-push, never rebase onto main
(the branch is not built on main; a PR merge comes later). `npm test` must stay green (314 at handoff).

## Where things stand

- Engine: text -> score (Binder/Avery haftarah, Torah, Moroccan Fez tables) -> MIDI / SoulX-Singer audio.
  Hebcal-driven readings. Spec: `docs/superpowers/specs/2026-10-15-trope-engine-design.md`; research index:
  `docs/superpowers/research/2026-10-15-trope-engine/README.md`.
- Daniel's ear on the first SoulX renders: consonants not clearly enunciated; "super computer-ey" rather
  than smooth and connected. Rulings: try **path 1** (Hebrew TTS -> SoulX-Singer-SVC re-sings to our score
  f0; Phonikud non-commercial licence OK as an intermediate step); if it fails, **path 3** (Cantor Josh
  Finkel's existing chant recordings; needs his written consent, Daniel to ask). Voice identity does not
  matter. Standard Reform (Binder/Avery) is the site default; Moroccan is next nusach; Modal is the cloud
  backend (Daniel has not yet made the account).
- Legato A/B (`research/.../legato-ab.md`): `--phrasing phrases` (rests only at phrase breaks) won clearly
  on I Samuel 20:18-19 (ivrit.ai Whisper CER 0.140 vs 0.18-0.24). Speech rhythm and full stress did not
  show a gain (within noise). Untested: `--stress flat`, `--tokens word`, `--f0 synth` (melody mode),
  `--steps`, `--cfg`, `--post`, new prompts. `--style v2` = the legato change; default is still v1.
- Speech-to-singing (`research/.../speech2sing-experiment.md`): Phonikud-TTS speaks phrases from our
  phonemes with score durations imposed inside the VITS graph (works, ~1 s/verse on CPU). The SVC sung
  stage has **never been rendered** (GPU was busy). Code: `scripts/trope-speech2sing.mjs`,
  `trope/speech2sing.{mjs,py}`, `trope/soulx_svc_runner.py`, `trope/s2s_pitch.py`.

## Setup on the laptop

Follow `docs/superpowers/plans/2026-10-15-trope-home-setup.md` sections 0-5 (SoulX venv on Python 3.12,
checkpoint, preprocess models, TTS venv + Phonikud voice + SVC checkpoint). Also the ASR scorer venv:
`py -3.12 -m venv %USERPROFILE%\haftarah-audio\asr-env` then `pip install faster-whisper soundfile numpy scipy`
(model `ivrit-ai/whisper-large-v3-turbo-ct2` downloads on first use). Voice prompt: rebuild
`vocalset-m6-dona` per section 3 (VocalSet m6 `FULL/male6/excerpts/straight/m6_dona_straight.wav`, CC BY 4.0;
the zip is 2.1 GB, or pull just that member by HTTP range requests). Its per-note tokens begin
`en_D-OW1 en_D-OW1 en_N-AA0 en_N-AA0 en_N-OW1 en_B-IY0-S en_P-AA1 <SP> en_CH-EH0-M ...` ("Dona nobis pacem").
Heavy files stay in `%USERPROFILE%\haftarah-audio\` (or `HAFTARAH_AUDIO`), never in git or the public Blob store.

## Work queue, in order

1. Smoke test SoulX on the 4070 (home-setup section 4); record seconds per verse vs the 1660 Ti (~6x real
   time). Consider raising `MAX_SEGMENT_SECONDS` in `trope/soulx.mjs` if VRAM allows.
2. **Path 1, the priority:** `node scripts/trope-speech2sing.mjs --ref "I Samuel 20:18-19" --stage svc`, then
   `--stage svc --source world`; optionally Seed-VC singing mode (cloned, not installed). Pitch-check with
   `trope/s2s_pitch.py`, score with `trope/asr_cer.py` against `trope/env/ab/ref-text-i-samuel-20-18-42.json`.
3. Legato finalists on 6 verses each (I Samuel 20:18-23) so CER differences mean something: v1, `--style v2`,
   v2 + `--stress flat`, v2 + `--f0 synth`, v2 + `--post`; script `trope/env/ab/run_ab.sh`.
4. Put the best SoulX settings and the best path-1 output side by side for Daniel: same two verses, files
   named so the listening order is obvious, plus a one-paragraph summary with the numbers. Daniel decides by
   ear; if path 1 loses, prepare path 3 (what to ask Josh for: 15-20 min of dry chant, any format, plus
   written consent for training a voice/style model).
5. Then: full Machar Chodesh (I Samuel 20:18-42) with the winner; update the spec's renderer section and
   `research/README.md` with measured results.

Never run two GPU jobs at once. Daniel likes decisions in plain prose with numbered questions in chat.
