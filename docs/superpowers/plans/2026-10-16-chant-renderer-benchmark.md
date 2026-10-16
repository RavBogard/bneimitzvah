# Offline chant renderer benchmark — 2026-10-16

Status: concrete plan; **no recording, download, inference, training, cloud provisioning, spend or upload performed**. Builds on [the reassessment](../research/2026-10-16-chant-rendering-reassessment.md). This document changes no engine contract or mission ruling. Astra integrates; Sol implements bounded slices. Daniel remains the only human product tester, though a consenting adult cantor/tutor may supply recordings.

**Settled by Daniel, 2026-10-16:** sung practice uses **Adonai/Elohim, as in the ceremony**. Carry this into every reviewed target and recording instruction; do not reopen it as a benchmark question. Visible transliteration remains paused; internal phonemes are still required.

## Decision and acceptance criteria

Compare A (SoulX SVS) and B (native Hebrew source → timed audio → SoulX-SVC) on **the same reviewed text, phoneme/stress map, note sequence and phrase timing**. Use human chant as the teaching reference. Test human spoken input first to isolate conversion quality; test automatic Hebrew TTS separately to establish arbitrary-verse scalability. A passing human-source conversion does not prove that a TTS source will work.

Reject a candidate for an inserted/omitted/wrong word or syllable, incorrect teaching pronunciation/stress, wrong text-to-melisma attachment, or any Daniel finding of “would teach wrong.” Preference for voice timbre cannot overrule that. Among accepted conditions, rank blind diction/connectedness ratings, then manual repair burden, render reliability and measured cost. If A/B fail, do the staged C (Hebrew DiffSinger) data audit or a separately approved commercial trial. A custom trained voice is **not** a prerequisite for the existing human per-verse recording route.

This pilot cannot release generated audio. G1/G2 and Daniel's G3 (≥95% melody passes, zero “would teach wrong”) remain separate release gates, with the existing independent adversarial release review.

## Twelve reference-only passages

Verified **2026-10-16 against existing local fixtures and current pure Node score functions**, without inference or fetching new text: `calibration-torah.json`, `calibration-haftarah.json`, `edge-cases.json`, `week-notes-hebrew.json`; `verseUnits` → `scoreVerse` → `scoreToSoulx`. The check emitted only references, counts, phone inventories and cell IDs. No passage text is reproduced here.

Durations below describe the **current generated score**, key D3, tempo 96, v2 phrasing, supplied fixture flags; they do not certify the melody transcription or establish a comfortable singer key. Freeze actual review values after Daniel confirms them. Torah passages require `trope/cells/torah.json`; the four prophetic passages require `trope/cells/haftarah.json`.

| ID | Passage | Verified reason to include | Current score |
|---|---|---|---|
| P01 | Genesis 1:1 | Short common pattern; 18 syllables, 2 vocal shevas and 1 hataf; regular etnachta/silluq; vowel-initial connections. | 9.063 s, 1 segment |
| P02 | Exodus 35:20 | Short 17-syllable Torah passage; 1 qamatz qatan; vocal sheva/hataf; explicit aliyah cadence. Tests clean consonants without long-verse confounds. | 9.063 s, 1 segment |
| P03 | Deuteronomy 1:21 | 7 hataf syllables, multiple disjunctive boundaries, ח/כ realization; explicit aliyah flag; long enough to require a split. Apply settled Adonai/Elohim ceremony reading. | 34.063 s, 2 segments |
| P04 | Genesis 24:12 | Verified shalshelet cell, plus zakef gadol; demanding sustained vowel/melisma and breath recovery. Avoid repeating consonants on each note. | 29.063 s, 2 segments |
| P05 | Numbers 35:5 | 72 syllables; karnei farah, yerach ben yomo and legarmeh; 10 vocal shevas; broad consonant inventory. Long-verse split and cumulative timing stress. | 51.563 s, 2 segments |
| P06 | Leviticus 10:1 | Verified mercha kefula, rapid note changes and multiple phrase groups; 54 syllables, 4 hatafs. | 40.938 s, 2 segments |
| P07 | Genesis 27:33 | Verified pazer and zarka/segol contexts; 51 syllables and 3 hatafs. Repeated melodic movement and word-to-word joins. | 39.688 s, 2 segments |
| P08 | Genesis 50:26 | Qamatz qatan plus explicit end-of-book cadence; compare ordinary phrase endings with a genuinely flagged final cadence. | 17.500 s, 1 segment |
| P09 | I Samuel 20:18 | Existing measured legacy case, with 4 documented melismas; ח/כ and ר; inspect previously reported phrase-initial consonant and held-final-syllable failures. | 13.750 s, 1 segment |
| P10 | I Samuel 20:19 | Second legacy TTS case; 4 vocal shevas, 2 hatafs; צ and ז represented. Tests transfer beyond the original one-verse demonstration. | 19.063 s, 1 segment |
| P11 | I Samuel 20:27 | Existing text tests verify qamatz qatan and furtive patach; 51 syllables; closure/onset transitions and long phrase split. | 30.000 s, 2 segments |
| P12 | Isaiah 40:9 | Existing text tests verify furtive patach/final ה; current parser returns 2 furtive syllables. Distinguish final consonant, vowel offglide and an invented extra syllable. | 25.938 s, 1 segment |

P01/P02/P09/P11 form the **first diagnostic subset**. P04/P05 are demanding cases, not initial microphone checks. P01–P08 keep Torah first while P09/P10 preserve comparison with past evidence. This set is not exhaustive trope coverage and does not test Decalogue dual cantillation or special whole-passage tunes. Confirm each proposed failure class in the frozen per-syllable annotations; a phone appearing somewhere in a verse does not by itself prove a difficult boundary is present.

## Modest recording protocol

First session: **four paired passages only** (P01, P02, P09, P11), one spoken take and one sung take each; one optional corrected take if the reader notices a mistake. Add one 15–25-second dry sung prompt in a comfortable range and a few seconds of room silence. Aim for roughly 3–5 minutes of accepted audio, not a training corpus. Stop and inspect before requesting the other eight pairs or any systematic phone-coverage recording.

Use an existing microphone or phone recorder; buying equipment is unnecessary for this diagnostic. Quiet, soft-furnished room; close windows and turn off audible fans if practical. Keep the microphone at a consistent distance (roughly 15–25 cm), slightly off-axis to reduce plosives. Record mono WAV at 44.1 or 48 kHz, preferably 24-bit if available. Keep peaks around −12 to −6 dBFS; never clip. Preserve the untouched original. Disable reverb, music, aggressive noise suppression, automatic normalization and voice effects where the recorder allows it. Leave about one second before/after the passage. Use headphones for any guide track so it does not bleed into the microphone.

Spoken take: clear connected Hebrew at a natural teaching pace, without exaggerated syllable gaps. Sung take: the intended Binder/Avery pattern, comfortable key, clear consonants, and ordinary chant phrasing; no requirement to follow the current synthetic grid if it is musically wrong. Record the discrepancy. An optional second sung take can follow the reviewed target timing if needed to distinguish score defects from acoustic-model defects. Never train on an incorrect synthetic target merely to make the singer agree with it.

The sung prompt may be a short confirmed chant phrase, or a simple sustained-vowel passage whose phonemes/notes can be annotated accurately. A Hebrew prompt needs actual supported-token mapping for SoulX; do not label it as English lyrics or pass Hebrew IPA through an English lyric recognizer and assume the metadata is correct. The prompt preparation CLI's default maximum is 30 seconds; SoulX reads only its first metadata segment.

For each take, store privately: sample ID, passage ID, adult speaker ID, spoken/sung/prompt role, take number, original sample rate/channels, key/range if sung, approximate tempo, pronunciation profile and divine-name choice, exact source edition/retrieval hash, noticed deviations, microphone/room notes, trim interval, checksum, and consent record ID. Review word/syllable boundaries and note-to-vowel mapping before using the recording as a reference. Annotate pauses/breaths, final consonants and every melisma; alignment software may propose boundaries but a person checks the difficult ones.

**Adult consent is scoped:** specify private evaluation playback, voice conversion/reference prompting, any cloud processing, model training/fine-tuning, and intended distribution/retention of source clips, derived audio and any voice model. The initial protocol can authorize private local playback/prompting only; training requires its own explicit scope. A consenting recording donor does not automatically authorize every later use. Keep identity/consent records, recordings and models outside the public repo. The settled one-year retention of student submissions after the ceremony is **separate** from this adult reference corpus; record this corpus's retention/deletion decision explicitly.

## Existing seams and honest command examples

These are **documented existing entry points, not commands run by this plan**. Paths under `C:\private\chant-benchmark` are illustrative private destinations; configure/check real environments and rights before use. Existing CLI drivers fetch live Sefaria text, so they are smoke/iteration tools rather than the frozen offline benchmark.

```powershell
node scripts/trope-render.mjs --ref "I Samuel 20:18" --table trope/cells/haftarah.json --key D3 --tempo 96 --style v2 --backend local --prompt "C:\private\chant-benchmark\prompt.wav" --prompt-meta "C:\private\chant-benchmark\prompt.json" --out "C:\private\chant-benchmark\A-smoke"

node scripts/trope-speech2sing.mjs --ref "I Samuel 20:18" --table trope/cells/haftarah.json --key D3 --tempo 96 --style v2 --voice michael --prompt "C:\private\chant-benchmark\prompt.wav" --prompt-meta "C:\private\chant-benchmark\prompt.json" --stage tts --out "C:\private\chant-benchmark\B-tts-smoke"

node scripts/trope-speech2sing.mjs --ref "I Samuel 20:18" --table trope/cells/haftarah.json --key D3 --tempo 96 --style v2 --voice michael --prompt "C:\private\chant-benchmark\prompt.wav" --prompt-meta "C:\private\chant-benchmark\prompt.json" --stage svc --source timed --out "C:\private\chant-benchmark\B-tts-smoke"
```

The SVC-stage command requires already prepared source audio/F0 files; it does not generate them itself. `--source world` selects the alternate WORLD-stretched input. `--cpu` is supported. The TTS CLI currently selects Phonikud ONNX voices, not Chatterbox or arbitrary human speech. Preserve Daniel's previous authorization of Phonikud as an intermediate, while checking the exact restrictive license against the intended use before release. No new license acceptance is assumed here.

Environment seams: `HAFTARAH_AUDIO`, `HAFTARAH_SOULX_ENV`, `HAFTARAH_TTS_ENV`, `HAFTARAH_SOULX_SVC_MODEL`; prompt preparation also uses `HAFTARAH_SOULX_PREPROCESS`. Models/environments remain outside the repo. The SVC runner can load explicit job WAV/F0 paths, so it is reusable after a human-source alignment adapter exists. The existing main SVS runner consumes `jobs.json` with `repo/model/config/phoneset/prompt_wav/prompt_meta/device/fp16/control/n_steps/cfg/post/jobs`; each job has `meta` and `wav`. SVC's separate schema uses `repo/model/prompt_wav/device/fp16/n_steps/cfg/jobs`, each with `wav`, `f0`, `prompt_f0`, `out`.

**Important comparison defect to fix before benchmarking:** the main driver marks the fetched reading's last verse `final:true`; the S2S driver always builds with `final:false`. Neither carries the calibration fixture's explicit Torah `endOfAliyah`, `endOfBook` or `special` flags through its current fetch path. Thus two apparently matching CLI commands can produce different targets. Do not silently equate their outputs. Both default to the haftarah table unless `--table` is supplied.

`trope/s2s_pitch.py` is a diagnostic: median pyin pitch per note (first 40 ms/last 20 ms excluded) and quiet-frame share inside phrases. It does not prove onset pitch/short notes/word correctness; quiet stop closures are not necessarily choppiness. Existing S2S tests verify plan/control logic, not singing quality. Neither current manifest provides the complete benchmark provenance/blinding workflow below.

## Reproducible A/B run and listening record

First create a private, frozen job pack from locally available approved text: explicit reference/edition/hash; pronunciation/divine-name decision; `final/endOfAliyah/endOfBook/special`; table hash; and one canonical score/timing. `verseUnits`, `scoreVerse`, `scoreToSoulx`, `buildPlan` and `scoreF0` are the existing pure functions. A job builder can call them without changing their public contracts. Have Daniel confirm the target, then use exactly that target for both adapters. Preserve ordinary and special cadence flags deliberately.

Proposed benchmark manifest fields (a **new plan schema**, not an accepted engine API):

| Group | Required record |
|---|---|
| Identity | benchmark/run/condition/pass IDs; UTC time; Git commit and dirty-file hashes; hardware/VRAM/OS; output private path/hash; speaker/consent ID without names |
| Canonical target | passage ID/ref; text edition/hash; pronunciation/profile/version; divine-name policy; word/syllable IDs; score/table/timing/F0 hashes; key/tempo/flags; target-review status |
| Model | exact engine source commit; checkpoint/revision/checksum; vocoder/config hashes; code/weight/license record IDs; prompt audio/metadata hashes; preprocessing/alignment versions |
| Settings | lane A/B-human/B-TTS; all phrasing/rhythm/stress/token/F0 switches; steps/guidance/precision; seed if supported, otherwise `unsupported`/`unrecorded`; duration/noise/consonant cap; every manual edit |
| Runtime | elapsed/load/render time; peak allocated/reserved memory if available; failures/retries; cloud billed seconds/rate if later approved; human setup/repair minutes |
| Evaluation | G1/G2 diagnostic paths; blind clip ID; loudness-matching/playback method and speed; Daniel's scorecard/error timestamps; accepted artifact hash; release status always `private-unreleased` here |

Run A and B-human on the four-case subset first. For B-human, alignment and vowel-only retiming infrastructure is **missing**: preserve consonant spans, align vowel nuclei to the target, extend vowels, and supply matched voicing/F0. Do not reuse Phonikud's duration labels for a different human waveform. Keep original speech, retimed speech, DSP-only pitch baseline and final SVC output to locate any damage. Then substitute B-TTS only after its raw/timed speech passes word/stress review. Chatterbox V3 would require a separate adapter; no existing CLI flag selects it.

After subset success, run the 12 cases and three repeats of the difficult P04/P09/P11 conditions. Preserve all failures/retries; do not select only the best stochastic take. Existing SVS/SVC wrappers do not expose a seed control, so record that limitation rather than inventing a reproducibility guarantee. Loudness-match copies for review, keep original waveforms, randomize opaque clip labels, and keep the identity key separate. Compare normal speed and the intended slow-practice playback method; slowed artifacts should not be blamed on the renderer without checking the player.

Daniel's compact scorecard per blind clip:

```text
clip_id / passage_id / playback_speed:
Words + syllables: pass/fail; timestamp + error:
Pronunciation + stress: pass/fail; timestamp + error:
Notes + cadence + melisma attachment: pass/fail; timestamp + error:
Consonants/final sounds: clear/unclear; timestamp:
Connectedness 1–5:       Diction 1–5:
Would this teach anything wrong? yes/no; exact reason:
Manual repair needed? what/how many minutes:
Teaching-reference acceptable? yes/no:
```

Pitch analysis: stable note interiors within the existing ±50-cent criterion, with confidence/octave checks; separately inspect note count/order, short-note omissions and F0 around transitions. Record intended glides outside stable interiors. ASR CER and silence fraction are supporting diagnostics only. Publish no audio to learners from this protocol.

## C data audit and next implementation slice

C starts **only with an audit**, not a training promise: inspect approved adult clips for room/reverb, accurate text, every target phone, representative onset/coda combinations, sustained vowels, range and phrase types. Mark a held-out subset before label correction/training. Measure labeling minutes and actual unique coverage; identify missing sounds and request targeted additional recordings rather than arbitrary hours. Separately check any base checkpoint/vocoder rights. A short diagnostic dataset does not establish sufficient training data or that training fits the laptop's 8 GB VRAM. A later bounded training plan needs an explicit data/compute budget and its own held-out pass criteria.

**Next Sol slice:** implement the private offline job-pack builder and A/B manifest/blinding metadata around existing pure score functions, with explicit flags and adapter parity checks; no GPU or model change. Its acceptance check is that both lanes reference the same canonical syllable/note timeline and reject incomplete provenance. Then implement human-source alignment/retiming as its own slice. This is proposed work, not executable infrastructure already delivered.

**Daniel genuinely decides:** remaining pronunciation details and target chant/key; recording donor and permitted voice uses/retention; whether the proposed four-passage recording session is worthwhile; blind listening acceptance; and any later money/license question. Adonai/Elohim ceremony reading is already settled. Routine job-pack/annotation mechanics can proceed within authorization. New microphone purchases, new paid services, training or cloud uploads are not required to make this plan concrete.
