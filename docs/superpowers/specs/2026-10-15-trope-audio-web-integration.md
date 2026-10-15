# Trope audio on the web sheet: how generated chant plugs into the site

Design proposal, 2026-10-15, branch `trope-engine-research`. Nothing here is built. This document expands section 8 ("The web sheet") and Wave 3 of `2026-10-15-trope-engine-design.md`. It does not reopen the rulings in that spec's section 2. The other coder owns the web app, and section 13 says who edits which file.

Every `path:line` reference below is to `origin/main` at `89db3c6` ("Web 2.0: Wave 2 plan"). That is the commit this branch is rebased on, and the web files are identical on both. Wave 2 will move many of these lines. Where Wave 2 rewrites a file, the reference gives the main-branch line and names the Wave 2 task that changes it.

Rulings this design must hold (Daniel, 2026-10-15):

- Whose voice it is does not matter.
- Melodies come from standard published tables.
- Several nusach options come later: Standard Reform, Ashkenazi, Moroccan and others.
- The output is labelled AI-generated.
- Model weights and audio never go into git.
- The public Blob store gets nothing from the audio pipeline except finished MP3s.

## 1. Summary

- **One mono MP3 per verse.** Files are content-addressed: `chant/<table>/<voice>/<hash>.mp3` in a separate public audio Blob store. The site reaches the store same-origin through a new `/audio/` rewrite. A verse whose score has not changed is never rendered or uploaded again, and is reused across weeks and years.
- **One manifest per week.** `weeks/<slug>/chant.json` sits beside `sheet.json` as a side file (2.0 spec section 4.7). Per nusach option and per verse id it gives the file, its length and the per-word timings. The timings come from the score, because the renderer is driven by those durations. Section 4.4 asks Daniel to confirm that this small JSON may go public.
- **Encoding stays outside the repo, in the render environment.** The steps are WAV, then loudness normalisation, then CBR 64 kbps mono MP3 at 24 kHz, then an ID3 tag that says "AI-generated". There is no ffmpeg on this PC. In order of preference: `soundfile` (already in the venv, if its libsndfile has MP3), `lameenc` (one pip install into the venv), a static `ffmpeg.exe` kept in `haftarah-audio\bin`, or a vendored pure-JS LAME port.
- **Size.** A typical haftarah (35 verses of about 10 s) is about 2.8 MB at 64 kbps. A listener downloads only the verses they play.
- **The player.** A bar under the masthead, a "Play" action in each verse header, and "From here" starting at the verse on screen. The playing verse is highlighted and the sung word follows. Speed runs from 0.5 to 1 with pitch kept, and a verse can loop. In the presenter view, P plays the verse and an optional mode advances the slides with the audio.
- **Nusach.** A "Chant" row in the Aa card, filled from `chant.json` in menu order and remembered under `haftarah:v1:nusach`.
- **CSP.** Add `media-src 'self'`, the `/audio/` rewrite, and `/audio/` excluded from the CSP header the same way `/data/` is. `tests/csp.test.mjs` changes with it.
- **Timing.** No web file is touched until Wave 2's week-page work (Task 12) and docs task (Task 13) have merged. Until then, everything is on this branch in new files under `trope/`, `scripts/` and `tests/`.

## 2. What exists today (main) and what the integration hooks into

| Area | Where | What matters for audio |
|---|---|---|
| Hosting and rewrites | `vercel.json:9` (`/data/:path*` to the public week store), `vercel.json:10` (slug to `sheet.html`) | Audio gets a second rewrite of the same form, `/audio/:path*` to the audio store (2.0 spec line 277). |
| Cache headers | `vercel.json:13` (fonts `max-age=31536000, immutable`) | Content-hashed MP3s get the same header. |
| CSP | `vercel.json:15`; held by `tests/csp.test.mjs:8` (the exact string) and `:11-19` (sent everywhere except `/data/`) | There is no `media-src`, so `default-src 'self'` applies. A same-origin MP3 would already load. The 2.0 spec (line 198, line 277) still asks for an explicit `media-src 'self'` with a test. |
| Data addresses | `site/app/contract.js:10-13` (`weekPath`, `dataUrl`, `indexUrl`), `:25` (`verseAnchor`), `:31-37` (`parseVerseAnchor`) | Audio needs `audioUrl(src)` and `chantPath(slug)` here, with a pattern check on `src`. |
| Verse identity | `contract.js:25`; rows get `id = verseAnchor(...)` at `site/app/sheet.js:199`; 2.0 spec line 135 lists "audio cues" as a user of the id | Manifest keys are these ids exactly: `haftarah-54-3`, and `torah-6-9` once Wave 2 Task 12 lands. |
| One reading on the page | `sheet.js:121-123` (`primaryReading` then `sheetModel`) | Wave 2 Task 12 (plan lines 4010-4020) renders every reading with `r.reading` and `r.model`. The player is built on that version, not on today's. |
| Hebrew word spans | `sheet.js:172-186` (`wrapWords`, which skips `sup` and `.ketiv` at `:176`), `template/lib.js:48-54` (`hebrewWords`) | The page splits maqaf chains into separate words. The score's units are whole maqaf chains. Section 6.4 maps one to the other. |
| Current-verse tracking | `sheet.js:268-293` (`sync`, which sets `.row.current` at `:285-288`), `:256-258` (`railPause`) | "From here" starts at `current`. Auto-scroll during playback copies the `railPause` back-off. |
| Verse header actions | `sheet.js:222` (Copy link, Copy verse, on Sefaria), click handler `:322-333` | "Play" belongs here. `onAct` treats any `data-act` other than `link` as a copy (`:326`), so it needs a one-line guard. |
| Page API | `sheet.js:340-341` (`window.HaftarahPage = { rows, model, sync, goToHash, closeAll }`) | The chant module needs `rows` and the current row. |
| Check mode | `sheet.js:92-97` (collects `securitypolicyviolation` under `?check=1`), `scripts/web-check.mjs:91-140` | A missing `media-src` or a bad rewrite shows up in web-check. |
| Settings card | `site/app/settings.js:87-131`; the Show row pattern at `:94-95`; storage via `site/app/storage.js:41-53` (prefix `haftarah:v1:`) | The nusach row follows the Show row. Wave 2 Task 12 makes `initSettings` return `{ close, addDownload }` (plan line 4020), and a matching `addRow` is needed. |
| Presenter | `site/app/present.js:6-14` (`PRESENT_KEYS`), `:61` (help line), `:80-92` (`show`, which writes `stripKeys(v.heHtml)` with no word spans at `:84`), `:93-108` (`act`), `:124-139` (`exit`) | Play, pause and follow-audio keys are added. Word highlighting there needs the word wrapper moved into a shared module. |
| Analytics | `site/app/analytics.js:138-144` (`EVENTS` allow-list), `analytics-config.js:186` (`none`), `tests/analytics.test.mjs` | Any play count is a new allow-listed event (section 10). |
| Publish | `scripts/publish.mjs:28` (`STORE_ID`), `:30` (`MAX_AGE`), `:34` (`PUBLISHED_FIELDS`), `:62-75` (`indexEntry`), `:115-139` (`putBlob`, with `x-allow-overwrite: "1"` hard-coded at `:121`), `:185-187` (store check), `:198-200` (index last) | `chant.json` is a side file. MP3s go to a different store through the same `putBlob`, but must never overwrite. |
| Deliver | `scripts/deliver.mjs:194` (calls `publish`) | Chant upload is a separate step that runs after delivery. Shabbat delivery never waits on audio. |
| Static build | `scripts/web-build.mjs:34-48` (copies `site/` and the shared template files) | The player is plain modules in `site/app/`. Nothing new is needed in the build. |
| Footer credits | `site/sheet.html:33-36`; `sheet.js:152` (`footAttr`); `:155` (a footer line shown only while something is on) | The AI line and the table's source go here while chant is loaded. |
| CSS hooks | `site/web.css:140` (`.he .w.active`, the word panel's mark), `:149` (`.row.current`), `:212` (reduced motion), `:288` (print hides chrome) | Playback adds `.row.playing` and `.w.sung` as separate classes. The player is hidden in print. |
| Render output | `scripts/trope-render.mjs:41` (out dir in `haftarah-audio\renders`), `:50` (fetches the ref from Sefaria), `:56` (only `final` set), `:59` (`NN-<ref-slug>.wav`), `:117-127` (`manifest.json`), `:119` (`prompt.publishable`) | The encode step reads this manifest and refuses `publishable: false`. Rendering for the web takes the week's `sheet.json`, not a free ref (section 5.1). |
| Timing source | `trope/soulx.mjs:77-100` (`noteList`: every note on one rounded ms clock, `msAt = beats * 60000 / tempo`), `:133` (`lead = 0.25` s), `:17` (24 kHz, 50 frames per second) | Word onsets in the WAV are `250 + msAt(event.t)` ms. They are known before rendering. |

Wave 2 (plan `docs/superpowers/plans/2026-10-15-web-2-0-wave-2.md`) edits `sheet.js`, `settings.js`, `web.css`, `contract.js` (`PDF_FILES`), `publish.mjs`, `vercel.json` (the alias allow-list), `web-check.mjs`, `landing.js`, `index.html` and `lib.js` (file table, lines 43-86). The plan says its tasks run "strictly 1 → 13" (line 88). It also states that `hasAudio`, `hasWords` and `hasLinks` are not in Wave 2 (line 4445). Every web file this design needs is therefore in Wave 2's path, and that is why section 13 puts all web edits after Wave 2.

## 3. Storage layout and naming

### 3.1 Two stores, two kinds of object

| Store | Holds | Written by | Read by |
|---|---|---|---|
| Public week store (`STORE_ID`, `publish.mjs:28`), behind `/data/` | `weeks/<slug>/chant.json` (the manifest; no audio, no text, no local paths) | publish, as a side file | the page, on first Listen |
| Public audio store (new; 2.0 spec section 5.9 "a separate public Blob store for audio"), behind `/audio/` | `chant/<table-id>/<voice-id>/<hash>.mp3` and nothing else. Later also the cantor's `audio/<slug>/<reading>.mp3` (2.0 spec line 181). | the chant upload step, never overwriting | the `<audio>` element |

WAVs, score JSON, SoulX metadata, prompt clips, model weights and render manifests (which hold `C:\` paths, `trope-render.mjs:119-120`) stay in `C:\Users\dsbog\haftarah-audio\`. They are never committed and never uploaded. `weeks/` is already git-ignored (`.gitignore` line 9), so a local `weeks/<slug>/chant.json` cannot be committed by accident.

### 3.2 File names

```
chant/<table-id>/<voice-id>/<hash20>.mp3
  table-id  haftarah-binder-avery | torah-binder-avery | haftarah-moroccan-idelsohn …   (trope spec 4.2)
  voice-id  synth-1, synth-2 …   (one id per published prompt voice and renderer family)
  hash20    first 20 hex digits (80 bits) of sha256 over the canonical render key below
```

The render key is canonical JSON, with keys sorted and no whitespace:

```jsonc
{ "v": 1,
  "score": <score JSON from scoreVerse, minus "ref" and "table" (names, not sound)>,
  "renderer": "soulx-singer@<git sha of the SoulX clone>+emitter@<trope/soulx.mjs content hash>",
  "voice": "synth-1",
  "encode": "mp3-cbr64-24k-mono-lufs16@1" }
```

Why each part:

- **Content hash, not week or ref.** The same verse with the same reading flags (`final`, `endOfAliyah`, and so on) sounds the same in any week and any year. The trope spec already says it should be rendered once (section 8). Torah selections change from year to year and the hash still finds the overlap. A verse that is the last of one haftarah and a middle verse of another gets two files, as it should, because the closing cadence differs.
- **`ref` and `table` are dropped from the hashed score** so that a table renamed under trope spec 4.2 ("the two existing files are renamed") does not re-render every verse. The path still carries the table id, so a person can read it.
- **Table and voice in the path**, not only in the hash. It is readable, and "delete everything rendered with `synth-1`" is a prefix listing.
- **Renderer and encoder versions in the hash.** A model, emitter or bitrate change gives new names. Old pages keep pointing at old files until republished, so nothing breaks mid-week.
- **Files are immutable.** A name is never reused, which allows `immutable` caching (section 9) and uploads with `x-allow-overwrite: 0`.

### 3.3 Garbage collection

Nothing is deleted automatically. A later `scripts/chant-gc.mjs --dry-run` lists the audio store, collects every `src` named by any published `chant.json` (week list from `index.json`), and prints the unreferenced files and their total size. Deleting needs `--delete` and Daniel's yes.

## 4. The manifest the site reads: `weeks/<slug>/chant.json`

### 4.1 Shape

This builds on trope spec section 8's `{ tables: { <id>: { label, source, verses } } }` and makes three changes:

- It is keyed by nusach option, not by table, because the listener picks a nusach for the whole week and the option spans both readings.
- The options are an array, so the menu order (trope spec section 4.5) is data.
- Each verse carries its word timings.

```jsonc
{
  "schema": 1,
  "slug": "2026-10-17-noach",
  "kind": "generated",                  // "recorded" is reserved for the cantor (2.0 Wave 5); the page labels by kind
  "default": "binder-avery",            // the customs' nusach mapped to an option (see 7.2)
  "options": [
    {
      "id": "binder-avery",
      "label": "Standard Reform (Binder/Avery)",
      "source": "Binder/Avery tables as transcribed in TropeTrainer 3.2 (trope-grammar.md 2.3)",   // the table header's source line
      "tables": { "haftarah": "haftarah-binder-avery", "torah": "torah-binder-avery" },
      "voice": "synth-1",
      "rendered": "2026-10-16",
      "verses": {
        "haftarah-54-1": { "src": "chant/haftarah-binder-avery/synth-1/9f2c0d7a51e4b3c8a6d1.mp3",
                           "ms": 13990, "bytes": 112456,
                           "words": [[250, 1190, 0, 0], [1190, 2310, 1, 2], [2310, 3120, 3, 3]] },
        "torah-6-9":     { "src": "chant/torah-binder-avery/synth-1/….mp3", "ms": 12480, "bytes": 100322, "words": [] }
      },
      "missing": { "torah-6-14": "decalogue" }   // verses with no audio and why: "decalogue", "gate", "failed", "special"
    }
  ]
}
```

- `words` is one entry per score unit (maqaf chain): `[startMs, endMs, firstWord, lastWord]`. `firstWord` and `lastWord` are zero-based page word indexes (2.0 spec section 4.3, the `.w` count). An empty array means there are no word cues for that verse, and the page highlights the verse only (section 6.4).
- `ms` is the MP3's playable length, measured after encoding. `bytes` lets the page show a size ("about 3 MB") without fetching.
- `missing` makes a gap explicit, so the page can say "not available for this verse" and not fail without a word. The Decalogue verses are refused by the engine (trope spec 5.5). Song of the Sea and Journeys play with a "regular trope" note (trope spec 5.5); they are not missing.
- Size: about 35 verses × about 15 units × about 22 bytes is about 12 KB per option per reading before gzip. Five options and two readings come to about 120 KB raw and about 25 KB gzipped. It is fetched once, on first Listen.

### 4.2 Built from an allow-list

The public file is built field by field from the local render manifest, the same discipline as `PUBLISHED_FIELDS` (`publish.mjs:34`). A test fails if any string in it contains a drive letter, a backslash, `haftarah-audio`, `prompt` or `model`. Only verses whose render passed G1 and G2, and whose review set passed Daniel's G3 (trope spec section 7), are listed. A render whose manifest says `prompt.publishable: false` (`trope-render.mjs:119`) is refused outright.

### 4.3 How the page learns a week has chant

The 2.0 spec plans `has*` flags in the index (line 169, section 4.7), but the week page reads only `sheet.json` (`sheet.js:112`). Two options, for the other coder to choose (section 15):

- (a) publish adds a pointer to the published sheet, for example `"files": { "chant": "2026-10-16T…" }`. This is the same pattern as Wave 2's `prior` pointer (plan line 3104). It needs `PUBLISHED_FIELDS`, README's "Data file" section and `tests/publish.test.mjs:269-271` to change together.
- (b) the page also fetches `index.json` and reads `hasChant`.

(a) costs no extra request and serves words, links and translations in Wave 3 too. The recommendation is (a). `index.json` also gains `hasChant`, so the landing and the library can mark weeks that have chant.

### 4.4 The "only finished MP3s" ruling

The ruling is read here as: of everything the audio pipeline makes, only finished MP3s go public. No WAVs, prompts, weights, scores or local manifests. `chant.json` holds verse ids, file names, lengths and millisecond timings, and no text. If Daniel meant the stricter reading (nothing at all but MP3s), the fallback is deterministic paths, `chant/<table>/<voice>/<book>/<chapter>-<verse>[-final].mp3`, with word timings carried in an ID3 `SYLT` frame. That costs immutability (files get overwritten on re-render, so caching must be short), a HEAD probe or a 404 per missing verse, and the page would have to parse MP3 headers. It is not recommended. Open question D1.

## 5. Rendering for the web and the encode step

### 5.1 Render from the week, not from a free ref

`trope-render.mjs` today takes `--ref` and fetches Sefaria itself (`:50`), sets only `final` (`:56`), and names files `NN-<ref-slug>.wav` (`:59`). For the site, the verse list and ids must match the page exactly. The proposed change, on this branch:

- `trope-render.mjs --week weeks/<slug> [--reading haftarah|torah] --option binder-avery --voice synth-1` reads the week's `sheet.json` through `lib.readings()`. It feeds each verse's `he` HTML to `verseUnits` (which accepts sheet.json verses, trope spec 5.1), and sets the reading flags from the reading: `final` on the haftarah's last verse; `endOfAliyah` from `readings[].aliyot`; `endOfBook`; and `special` (trope spec 5.4).
- Files are named by verse id (`haftarah-54-3.wav`), and the render key hash is computed before rendering. A verse whose MP3 already exists in the audio store, checked by a HEAD request on the public URL, is not rendered at all. A re-delivered week re-renders only verses whose score changed, which is the trope spec's Wave 3 exit test.

### 5.2 Encode pipeline

`scripts/chant-encode.mjs <render-dir> --week weeks/<slug>` (new, on this branch) runs these steps for each verse WAV:

1. **Read the WAV.** A small dependency-free reader in `trope/chant.mjs` (PCM 16/24-bit and float32, mono). SoulX writes 24 kHz (`trope/soulx.mjs:17`).
2. **Measure loudness (ITU-R BS.1770 integrated, K-weighted, gated)** in JS, about 80 lines, unit-tested against the EBU reference tones. Apply one gain to reach -16 LUFS (2.0 spec line 276). Check the true peak stays at or below -1 dBTP, and refuse the verse if it would clip. This is gate G2's loudness and clipping check, done in the same place.
3. **Encode** to MP3, CBR 64 kbps, mono, 24 kHz (MPEG-2 Layer III). Use CBR, not VBR: with an Xing/LAME header it gives exact `duration` and exact seeking in Safari. VBR files without a correct header report wrong lengths on iOS. See 5.3 for the encoder.
4. **Tag.** Prepend an ID3v2.3 tag written by our own code (about 40 lines; the format is simple): `TIT2` "Isaiah 54:3", `TPE1` "AI-generated chant (synthetic voice)", `TALB` "Torah from Scratch, Central Reform Congregation", `COMM` with the label sentence and the table source, and `TXXX:generator` with the render key. A downloaded file still says what it is.
5. **Measure** the encoder's leading delay once per encoder setting. LAME adds roughly 50 ms at 24 kHz, and most browsers trim it using the LAME header. If a browser does not trim it, store the offset as `offsetMs` per option so the cues line up.
6. **Write** `mp3/<hash20>.mp3` and the public `chant.json` under the render folder, plus `chant-private.json` (local paths, gate results) for audit.

`scripts/chant-publish.mjs weeks/<slug>` (new) uploads MP3s only, to the audio store. Its token is `HAFTARAH_AUDIO_BLOB_TOKEN` or `~/.haftarah-audio.json`, checked against a pinned `AUDIO_STORE_ID` the way `publish.mjs:185-187` checks the week store. It skips any file the public URL already serves, never overwrites, and copies `chant.json` into `weeks/<slug>/`. Publishing `chant.json` itself is publish's job (section 13).

### 5.3 Encoders that need no ffmpeg on this PC

| Option | What it is | Install | Bitrate control | Licence | Verdict |
|---|---|---|---|---|---|
| A. `soundfile` in the existing render venv | libsndfile 1.1 and later encodes MP3 through LAME. The soundfile 0.12+ wheels bundle a libsndfile with MPEG support. | none, if the venv's soundfile and libsndfile are new enough (check `soundfile.__version__`, `__libsndfile_version__`, and that `available_formats()` lists `MP3`) | soundfile 0.13 adds `bitrate_mode` and `compression_level` to `write`. Mapping these to exactly 64 kbps CBR must be measured. | BSD (soundfile), LGPL (libsndfile, LAME), outside the repo | **First choice.** No new install. Node sends the normalised float WAV to a short Python script and gets the MP3 back. |
| B. `lameenc` (pip, into the same venv) | A Python binding with LAME bundled in the wheel | one `pip install lameenc` inside `haftarah-audio\soulx-env\venv`, outside the repo | explicit: `set_bit_rate(64)`, `set_in_sample_rate(24000)`, `set_channels(1)` | LGPL, outside the repo | **Second choice** if A cannot pin the bitrate. |
| C. Static `ffmpeg.exe` | A portable build in `C:\Users\dsbog\haftarah-audio\bin\`, not installed system-wide | download one file | full (`-b:a 64k -ac 1`), plus `loudnorm` | GPL/LGPL build, outside the repo | Good if the other coder adopts ffmpeg for 2.0 Wave 5 (2.0 spec line 276 already names it as an optional external tool). Then both pipelines share one tool. |
| D. Vendored pure-JS LAME port (`lamejs`, or a maintained ESM fork) | LAME 3.98 ported to JS, about 150 KB, runs in Node with no install | vendored under `trope/vendor/` with `LICENSE` and `PROVENANCE.md`, exactly like havarotjs (trope spec 5.2) | `new Mp3Encoder(1, 24000, 64)` | LGPL-3.0 inside the public repo | Only if encoding must run without Python, for example in `npm test` or on another machine. The licence needs Daniel's yes. Check the port's MPEG-2 (24 kHz) output in a real browser first. |
| E. Windows Media Foundation's built-in MP3 encoder | Ships with Windows 8 and later | none, but reachable only through .NET or COM code | yes | system | Rejected: Windows-only glue code, and no gain over A. |

Opus or AAC would save about 30% at the same quality, but MP3 is the ruling, and MP3 is the one format every browser and every downloaded-file player handles.

## 6. Player UI

### 6.1 Where it lives

Two new modules, both CSP-clean (no inline script, no `style` attribute, positions set through the CSSOM, `tests/csp.test.mjs:21-38`):

- `site/app/chant.js` loads `chant.json`, validates every `src` against `^chant/[a-z0-9-]+/[a-z0-9-]+/[0-9a-f]{20}\.mp3$`, and picks the option.
- `site/app/player.js` is the audio element, the queue, the bar, the highlight loop and the presenter hooks.

Hook points in existing files are kept to a few lines (section 13). The player API accepts a source of the form `verse(id) → { src, startMs, endMs, words }`. A generated week returns one file per verse (`startMs = 0`). The cantor's 2.0 Wave 5 recording returns one file per reading with cue ranges from `timings.json` (2.0 spec line 180). One player then serves both. The other coder owns that shared module once Wave 5 starts.

### 6.2 Controls

- **Listen.** A button in the hero, beside the PDF link (`sheet.js:138`), and a row in the Aa card. It opens the bar and plays from the first verse of the reading on screen. It appears only when the week has chant (section 4.3).
- **The bar.** Inserted after `#mast` (`site/sheet.html:15-22`) by script, so `sheet.html` does not change. It is sticky under the masthead on wide screens and sits at the bottom, with a safe-area inset, under 640px. It holds:
  - Play/Pause.
  - Previous and Next verse.
  - "From here", which jumps to the verse `sync()` marks current (`sheet.js:285-288`).
  - Speed: 0.5, 0.75 or 1, using `playbackRate` with `preservesPitch`, which current browsers keep by default.
  - Loop this verse.
  - The verse label ("Isaiah 54:3").
  - The nusach name.
  - The AI label (section 8).
  - Close.

  Every control is a `<button>` with a visible focus ring and a 44px target. The toggles carry `aria-pressed`.
- **Per verse.** "Play" in each verse header (`sheet.js:222`), beside Copy link. On a phone it is reached by tapping the verse number, which already opens the header (`sheet.js:318`). It plays that verse and then continues unless Loop is on.
- **Continuous play.** The verse files play in sequence with a 0.6 s gap, matching the render's concat gap (`trope/soulx_runner.py:97`). The next verse is preloaded into a second `Audio` element when the current one is half done. Nothing is preloaded before the first press (`preload="none"`).
- **What does not change.** A tap on a Hebrew word still opens the word panel (`panel.js`), and a tap on the verse number still opens commentary. Playback never takes over an existing gesture.

### 6.3 Follow-along

- The verse playing gets `.row.playing` and `aria-current="true"`. This is a new class, separate from the scroll-driven `.row.current` (`web.css:149`), so the two never fight.
- If the playing row leaves the viewport, the page scrolls it back to the top. It holds off for 3 s after the reader scrolls by hand, the same back-off the rail uses (`sheet.js:256-258`), and scrolls instantly under `prefers-reduced-motion` (`web.css:212` pattern). Once the row is in view, `sync()` marks it current and the rail follows on its own.
- **Word highlighting.** A `requestAnimationFrame` loop reads `audio.currentTime`, because `timeupdate` fires only about every 250 ms (chant-audio.md line 114). It moves `.w.sung` across the words given by the current `words` entry. Styling is a 2px underline in rubric plus a light wash. It is not a background colour change, so trope colours (`template/trope.css`) and teacher-highlight tints (`.hl-w`) stay readable, and the mark does not rely on colour alone. It is separate from the word panel's `.w.active` (`web.css:140`).
- `verse_view` analytics (`sheet.js:287`) will fire as playback scrolls. That is acceptable, because the reader is viewing those verses. It is noted for the analytics question in section 10.

### 6.4 Word timings from the score

The renderer is driven by the score's durations. `noteList` (`trope/soulx.mjs:77-100`) puts every note on one rounded clock, `msAt(beats) = round(beats × 60000 / tempo)`, after a 250 ms lead (`:133`). So unit *u* starts at `250 + msAt(first event of u .t)` and ends at the next unit's start, or at the end of its last note. A verse split into segments (`MAX_SEGMENT_SECONDS`, `:16`) is joined back on the same clock, because segment `time` ranges are contiguous (`:139-143`).

To map units to page words, `trope/chant.mjs` counts `lib.hebrewWords(unit.text)` per unit (maqaf chains split, as `wrapWords` does at `sheet.js:177`) and accumulates the counts. The page's count comes from the same `sheet.json` verse, run through the same `lib.js` with `sup` and `.ketiv` skipped (`sheet.js:176`). If the two totals differ for a verse, `words` is `[]` and that verse gets verse-level highlighting only. A ketiv/qere edge or a divine-name form can cause this. A test runs the mapping over both calibration corpora and the two web fixtures, and lists every verse that falls back.

Gate G1 already segments the rendered f0 into notes (trope spec section 7). It records the measured onset drift per unit. If any unit drifts more than 80 ms from the score clock, the measured onsets replace the computed ones for that verse.

### 6.5 Presenter view

Zoom viewers hear the audio only if the leader shares sound ("Share sound" in Zoom's share dialog). The help line says so.

- **New keys** in `PRESENT_KEYS` (`present.js:6-14`): `p` plays or pauses the verse on screen; `a` turns on "follow the audio", in which the slide advances when each verse ends. Follow is off by default, so the leader keeps control. The help line (`present.js:61`) gains "P play · A follow audio".
- **Stepping and audio.** Stepping with the remote (`act("next")`, `present.js:97`) while audio plays moves the audio to the new verse. Blank (`b`) pauses. Exit (`present.js:124-139`) stops playback and hands the position back to the page player.
- **Word highlighting on the shared screen** needs word spans. `show()` writes `stripKeys(v.heHtml)` raw (`present.js:84`). The word wrapper (`sheet.js:172-186`, now a closure) moves to a shared module so the presenter can wrap words too.
- **The AI label on the shared screen.** While generated audio plays, a small corner line reads "AI-generated chant". Viewers on Zoom never see the reader's bar.

## 7. Nusach selector

### 7.1 Where and how

- A "Chant" row in the Aa card, built like the Show row (`settings.js:94-95`): a segmented group of buttons with `aria-pressed`, one per option in `chant.json` order (trope spec 4.5 menu order).
- It is hidden when the week has one option. Daniel can still read which option it is in the bar and the footer.
- The choice is stored with `store("nusach", id)` (`storage.js:51-53`), so the key is `haftarah:v1:nusach`, and it is read back on the next page.
- The row is added after `chant.json` loads. That needs an `addRow` from `initSettings` next to Wave 2's `addDownload` (plan line 4020).

### 7.2 Defaults and gaps

- **Default order:** the stored choice if the week offers it, else `chant.json`'s `default`, else the first option. Publish fills `default` from `customs.nusach` through a map in the customs file, for example `"eastern-ashkenazi"` to `"binder-avery"`. The customs field is still in Wave 2's `toConfirm` (plan line 23), so it is open question D6.
- **A reading the option lacks.** A haftarah table can ship before its Torah table (trope spec 4.5). In that case the bar says "Moroccan is not yet available for the Torah reading; playing Standard Reform (Binder/Avery)" and plays the default for that reading.
- **Changing nusach mid-play** restarts the current verse in the new option.

## 8. The AI-generated label

### 8.1 Where it appears

- In the bar, always visible while any generated audio is loaded (not only while sound plays).
- In the footer credits while chant is on the page, next to `footAttr` (`sheet.js:152`). The line names the table's source.
- In the presenter corner while playing (section 6.5).
- In every MP3's ID3 tag (section 5.2).
- **The page chooses the wording by `kind`**, from a string in code that Daniel has approved. It does not read the wording from `chant.json`, so a data mistake can never drop the label.

### 8.2 Wording options for Daniel

| | Bar (short) | Footer (long) |
|---|---|---|
| A (the trope spec's draft) | AI-generated chant | AI-generated. Melody computed from the te'amim; voice synthetic. Melody: Standard Reform (Binder/Avery), after Binder and Avery. |
| B (plainest) | Computer-sung | Sung by software, not by a cantor: the melody follows the trope marks (Standard Reform, Binder/Avery) and the voice is AI-generated. |
| C (with a learner's caveat) | AI voice · check with your teacher | AI-generated chant: the melody is computed from the trope marks and the voice is synthetic. It can make mistakes; learners should check with their tutor or cantor. |
| D (minimal) | AI | Generated audio (AI voice). Melody: Standard Reform (Binder/Avery). |

Recommendation: A in the bar. For the footer, A's long line, plus C's last sentence if Daniel wants the caveat for b'nei mitzvah learners. The table's source line comes from its header (`source`, trope spec 4.2). The credits table in 2.0 spec section 8 (line 340 holds the cantor's line) gains a row: "Chant: AI-generated (synthetic voice). Melody: <table source>."

## 9. Caching

| Object | Cache-Control | Why |
|---|---|---|
| `chant/…/<hash>.mp3` | `public, max-age=31536000, immutable`, through both `putBlob`'s `maxAge` (`publish.mjs:122`) and a `vercel.json` header for `/audio/(.*)` (same form as fonts, `vercel.json:13`) | The name is the content and never changes. |
| `weeks/<slug>/chant.json` | `max-age=60`, like `sheet.json` (`publish.mjs:30`) | A re-render must show within a minute. |
| `index.json` | unchanged (60) | |

- **Range requests.** Safari will not play a media file from a server that does not answer a `Range: bytes=0-1` probe with `206`. Blob serves ranges directly. Whether Vercel's external rewrite passes `Range` through and returns `206` must be checked on a preview deploy before Phase 3 (question O5). If it does not, the fallback is `media-src 'self' https://<audio-store>.public.blob.vercel-storage.com` with direct URLs. That costs the same-origin property the 2.0 spec wanted.
- **PWA (2.0 Wave 5).** Content-hashed MP3s are safe to cache first. The 2.0 spec's "audio saved for offline only on request" (line 286) holds: a "Save this reading for offline" button stores that reading's files for the chosen option.

## 10. CSP, privacy, analytics

- **`vercel.json:15`** gains `media-src 'self'`. Its `source` changes from `/((?!data/).*)` to `/((?!data/|audio/).*)`, so an MP3 opened as a top-level tab is not given a page CSP. This is the same reasoning as the PDF exception in 2.0 spec line 198.
- **`tests/csp.test.mjs`** changes with it: the expected string at `:8`, the source assertion at `:14`, and `/data/…` plus `/audio/chant/x.mp3` both outside the policy at `:18`.
- **New test:** every `src` the page accepts is under `/audio/`. This follows the pattern `analytics-config.js:181-185` uses to hold the config and the CSP together.
- **Not needed:** no `blob:` and no `connect-src` change. The audio element loads by URL. Fetching `chant.json` is `/data/`, which is already `'self'`.
- **Privacy.** Playing sends no data anywhere except requests for the files themselves, same-origin. No storage except the nusach choice.
- **Analytics.** An optional new event `chant_play` `{ week, option }`, counted once per page view per option, the same de-duplication `verse_view` gets at `analytics.js:174`. It needs `EVENTS` (`analytics.js:138-144`) and `tests/analytics.test.mjs` changed. If turned on, the footer privacy line (`sheet.js:155`) would mention listening. Open question D8.

## 11. Accessibility

- Every control is a `<button>` with a name ("Play Isaiah 54:3", "Pause", "Speed 0.75", "Loop this verse") and `aria-pressed` on toggles. Tab order runs bar first, then page. Escape closes the bar's speed menu. There are no new global shortcuts outside the presenter, because Space must keep scrolling the page.
- **Announcements.** One polite live region. It speaks on user actions only ("Playing Isaiah 54:3", "Paused"), not on every automatic verse change. It reuses the page's existing copy-status region (`sheet.js:335-337`) or a second one, which needs a matching web-check line (`web-check.mjs:114` counts one today).
- **No autoplay.** Focus never moves on auto-advance, and auto-scroll respects reduced motion.
- **Not colour alone.** The playing verse has the `aria-current` attribute and a bar mark. The sung word has an underline, and its contrast holds in dark mode and under trope colours.
- **Transcript.** The page itself is the text of the audio, so no separate caption track is needed for audio-only content. Each verse's Hebrew sits next to its Play button.
- **Speed.** Down to 0.5 with pitch kept, for learners.
- Everything meets Wave 1's 44px floor (`web-check.mjs:115`, `:123`, `:124`), and web-check gains the same check for the bar.

## 12. Mobile data and storage budget

At 64 kbps, CBR mono, a verse costs 8 KB a second: 40 KB for 5 s, 80 KB for 10 s, 120 KB for 15 s, plus about 0.5 KB of ID3 tag.

| Haftarah | Length | 48 kbps | **64 kbps** | 80 kbps | 96 kbps |
|---|---|---|---|---|---|
| Short: 25 verses × 5 s | 125 s | 0.75 MB | **1.0 MB** | 1.25 MB | 1.5 MB |
| Typical: 35 × 10 s | 350 s | 2.1 MB | **2.8 MB** | 3.5 MB | 4.2 MB |
| Long: 50 × 15 s | 750 s | 4.5 MB | **6.0 MB** | 7.5 MB | 9.0 MB |
| Engine measured: 25 × 13.75 s (I Samuel 20:18 at tempo 96) | 344 s | 2.1 MB | **2.75 MB** | 3.4 MB | 4.1 MB |

(MB = 10^6 bytes. The cantor recordings in chant-audio.md line 82 average 18.7 s a verse. The engine at tempo 96 runs about 14 s.)

- **Bitrate.** 64 kbps is the recommendation for one voice at 24 kHz. It is clean for a synthetic voice, and 48 kbps starts to smear sibilants. The bitrate is in the render key, so changing it later re-encodes, but it does not re-render.
- **What a listener pays.** Only what they play. With no prefetch until the first press and one verse of look-ahead, a listener who plays three verses downloads about 250 KB. `navigator.connection.saveData` (where present) turns off the look-ahead. The Listen button's title gives the reading's total ("about 3 MB").
- **Storage, per option and voice, at 64 kbps:**
  - The weekly haftarah cycle (1,239 verses, chant-audio.md line 76) plus specials, about 1,600 verses × 14 s: about 180 MB.
  - Torah selections of about 20 verses a week: about 120 MB a year, falling as the years overlap.
  - Five options across the whole haftarah cycle would be about 900 MB. That is over the comfortable share of Hobby's 1 GB (2.0 spec line 366).
  - So the default is to render weeks as they are published, not the whole cycle up front for every option, and to measure before any backfill.
- **Transfer.** At 2.8 MB per full listen, Hobby's 10 GB a month covers about 3,500 full haftarah listens a month.

## 13. Who edits what, and the phases

### 13.1 Files

| File | Change | Who | When |
|---|---|---|---|
| `trope/chant.mjs` (new) | render key and hash, WAV reader, BS.1770 loudness, ID3 writer, unit-to-word mapping, manifest builder and allow-list | this branch | Phase 1 |
| `tests/trope-chant.test.mjs` (new) | the above; corpus word-mapping report; no local path in a public manifest | this branch | Phase 1 |
| `scripts/trope-render.mjs` | `--week`, `--reading`, `--option`, `--voice`; reading flags; verse-id names; skip known hashes | this branch | Phase 1 |
| `scripts/chant-encode.mjs`, `scripts/chant-publish.mjs`, later `scripts/chant-gc.mjs` (new) | encode; upload MP3s to the audio store only | this branch | Phases 1-2 |
| `tools/chant-preview/` (new, not deployed: `web-build` copies only `site/`, `scripts/web-build.mjs:34-40`) | a local page that plays a render with highlighting, for Daniel's G3 review and the iPad and Safari tests | this branch | Phase 1 |
| `vercel.json`, `tests/csp.test.mjs`, `tests/contract.test.mjs` | `/audio/` rewrite, `media-src`, CSP source, immutable header | the other coder (or this branch's PR, reviewed by them) | Phase 3 |
| `scripts/publish.mjs`, `README.md`, `tests/publish.test.mjs` | upload `chant.json` as a side file; `hasChant`; the sheet pointer (4.3) | the other coder | Phase 3 |
| `site/app/contract.js` | `chantPath`, `audioUrl`, the `src` pattern | the other coder | Phase 3 |
| `site/app/chant.js`, `site/app/player.js` (new), `site/web.css` | player, bar, follow-along, styles | joint: new files from this branch, CSS reviewed | Phase 3 |
| `site/app/sheet.js` | about 5 lines: init the chant module, the `onAct` guard, expose the current row, footer line | the other coder | Phase 3 |
| `site/app/settings.js` | `addRow` | the other coder | Phase 3 |
| `site/app/present.js` | keys, hooks, word wrapping, corner label | the other coder | Phase 4 |
| `scripts/web-check.mjs`, `tests/browser.test.mjs` | the bar exists with its label; `canPlayType("audio/mpeg")`; a fixture `chant.json` served from a local fake store; no CSP violation | the other coder | Phases 3-4 |
| `site/app/analytics.js`, `tests/analytics.test.mjs` | `chant_play` (if D8 is yes) | the other coder | Phase 4 |

### 13.2 Phases

| Phase | What | Touches main? | Exit test |
|---|---|---|---|
| **0. This document** | Answers to sections 14 and 15 | no | Daniel's answers to D1-D13, the other coder's to O1-O13 |
| **1. Encode and preview (branch)** | `trope/chant.mjs` and tests; `chant-encode.mjs` with encoder A (else B or C); `trope-render --week`; `tools/chant-preview/`; MP3s played from a local server on iPad Safari, iPhone Safari, Chrome Android and desktop | no | `npm test` green. A real week's haftarah encodes at 64 kbps CBR at about 8 KB/s. Loudness is within ±1 LU of -16. The ID3 tag reads "AI-generated" in a desktop player. Word cues line up by ear on 5 verses. Measured encoder delay recorded. |
| **2. The audio store (branch and Daniel)** | Daniel creates the audio store and its token; `chant-publish.mjs` uploads one week's MP3s (no overwrite, skip existing); range check against the store URL directly | no web files | Files fetch with `206` on a range request from the store's own URL. Nothing but `.mp3` is in the store. |
| **3. Web integration (after Wave 2's Task 12 and Task 13 merge)** | rewrite and CSP; publish side file and `hasChant`; contract; player bar, per-verse Play, From here, verse highlighting; nusach row; AI label (approved wording) | yes, in the files above | A published week plays any verse of both readings in Binder/Avery, with the verse highlighted and the label shown (the trope spec's Wave 3 exit test). The deployed page reports no CSP violation. iPad Safari plays through `/audio/`. Re-delivery re-renders only changed verses. |
| **4. Follow-along and presenter** | word highlighting; presenter `p` and `a`; corner label; speed and loop; analytics if approved | yes | On Zoom with "Share sound", a leader steps a haftarah with the remote while it plays, and viewers see the sung word move. |
| **5. More options and offline** | each new nusach table (trope Wave 4) adds an option to `chant.json`; the 2.0 Wave 5 PWA caches a reading on request; the shared player takes the cantor's `timings.json` source | yes | A week with two options switches nusach mid-reading. An installed iPad plays a saved reading with no network. |

Phase 1 and Phase 2 can run now, alongside Wave 2, because they touch no file Wave 2 touches. Phase 3 starts only after Wave 2's Task 12 (the two-reading week page) and Task 13 (docs) are on main. Then the player is written against Wave 2's rows (`r.reading`, `r.model`) and not against today's single reading.

## 14. Open questions for Daniel

1. **D1. The manifest in public.** Is `weeks/<slug>/chant.json` (verse ids, file names, lengths, millisecond timings, no text) acceptable in the public week store under "only finished MP3s"? Or should only MP3s go public, with deterministic file names (section 4.4)?
2. **D2. Label wording.** A, B, C or D in section 8.2, or a mix. Should the learner's caveat ("check with your tutor or cantor") be included?
3. **D3. Bitrate.** 64 kbps (about 2.8 MB for a typical haftarah) or 48 kbps (about 2.1 MB, to save storage across five options)?
4. **D4. Encoder.** If `soundfile` cannot pin 64 kbps CBR, may Claude run one `pip install lameenc` inside the render venv, or put a portable `ffmpeg.exe` in `haftarah-audio\bin`? Is a vendored LGPL JS encoder in the public repo acceptable as the last resort?
5. **D5. Render scope.** Only the weeks as they are published, or a backfill of the whole haftarah cycle for Standard Reform (about 180 MB)? Torah: only Daniel's weekly selection?
6. **D6. Default nusach.** Should the listener's default be Standard Reform (Binder/Avery)? This also settles `customs.nusach` (still in Wave 2's `toConfirm`).
7. **D7. One-reading options.** When an option exists only for the haftarah, should the selector still offer it, with the Torah falling back to the default as in section 7.2?
8. **D8. Counting plays.** Add an aggregate `chant_play {week, option}` count? It would change the footer privacy line.
9. **D9. Presenter.** Should "follow the audio" be off by default? Should the shared screen show "AI-generated chant" while playing?
10. **D10. Speed and loop.** Is 0.5 to 1 enough, or should it go up to 1.25? Is loop wanted for class use or only for learners?
11. **D11. Downloads.** Offer a whole-reading MP3 download for learners? It is a finished MP3, about 3 MB, rendered as the full concat. Or play on the page only?
12. **D12. A new voice.** When the published prompt voice changes (trope spec open item 1), are past published weeks re-rendered, or only new ones?
13. **D13. The audio store.** Daniel creates the second Blob store (2.0 spec section 5.9) and puts its token where `chant-publish.mjs` reads it (`~/.haftarah-audio.json`). Confirm the Vercel plan, since 2.0 open item 3 is still open.

## 15. Open questions for the other coder

1. **O1. Sequencing and ownership.** Is it agreed that no web file changes until Wave 2's Task 12 and Task 13 merge? For Phase 3, would you rather implement it from this document, or review a PR from a branch (new `site/app/chant.js` and `player.js`, plus small hooks)?
2. **O2. How the page learns a week has chant.** A pointer in the published `sheet.json` (a `files` object, like Wave 2's `prior`), or the page reading `index.json` for `hasChant` (section 4.3)? Should Wave 3's words, links and translations use the same mechanism?
3. **O3. Publish and the audio store.** Should `publish.mjs` upload `chant.json` when `weeks/<slug>/chant.json` exists? Should `putBlob` take an `overwrite` option (`:121` hard-codes `"1"`) so the audio uploader can refuse overwrites? Do you prefer the audio uploader as a separate script importing `putBlob`, or as part of publish?
4. **O4. `vercel.json` and the CSP.** Are the `/audio/:path*` rewrite, `media-src 'self'`, the CSP source excluding `audio/`, and the immutable header on `/audio/(.*)` acceptable, with `tests/csp.test.mjs` updated in the same commit?
5. **O5. Range requests.** Does Vercel's external rewrite pass `Range` through and return `206` from Blob? Safari needs it. Can you check on a preview deploy?
6. **O6. Quota isolation.** Is Blob's Hobby quota per store or per account? The 2.0 spec's reason for a separate audio store (line 277, line 366) holds only if it is per store.
7. **O7. `sheet.js` hooks.** Can `onAct` (`:322-333`) ignore a `data-act` it does not know? Can `window.HaftarahPage` (`:340-341`) expose the current row? Can `wrapWords` (`:172-186`) move to a module the presenter can use?
8. **O8. `settings.js`.** An `addRow(html, onMount)` beside Wave 2's `addDownload`, so the nusach row can be added after `chant.json` loads?
9. **O9. `present.js`.** Are the keys `p` and `a`, an audio hook in `act` and `exit`, and the help-line text acceptable? Does `b` (blank) pausing audio match how you see the blank screen?
10. **O10. One player for both audio sources.** Agree the source interface in section 6.1, so 2.0 Wave 5's cantor recordings and the generated chant share one player and one bar. Who owns that module?
11. **O11. Analytics.** If Daniel says yes to D8, is the `EVENTS` addition yours?
12. **O12. PWA cache.** Is your Wave 5 cache plan compatible with cache-first for content-hashed MP3s and network-first (60 s) for `chant.json`?
13. **O13. web-check.** What should web-check assert for audio without sound output? Proposed: the bar and label exist, `canPlayType("audio/mpeg")` is non-empty, a fixture MP3 from a local fake store answers `206`, and there is no CSP violation.

## 16. Out of scope here

- Rendering at request time or in the browser (trope spec section 10).
- Word-level karaoke beyond the sung-word mark. The 2.0 spec's "word-level karaoke" non-goal (line 360) is reopened only as far as the score's unit timings allow: no per-syllable or per-letter display.
- Record-yourself (2.0 Wave 5).
- Trope drills tied to the generated voice. They could follow later from the same cell tables, rendered as motifs, but they are not proposed here.
- Any change to the printed sheet. Audio is web-only, and print hides the bar (`web.css:288`).
