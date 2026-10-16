#!/usr/bin/env bash
# One voice A/B variant: render I Samuel 20:18-19 (or $REF) at $KEY into $HAFTARAH_AUDIO/renders/ab/<name>, then
# pitch (pitch_check.py), legato (trope/gap_check.py) and intelligibility (trope/asr_cer.py) metrics.
#   bash trope/env/ab/run_ab.sh <name> [trope-render flags...]     e.g.  bash trope/env/ab/run_ab.sh legato --phrasing phrases
# Env: HAFTARAH_AUDIO (default ~/haftarah-audio, holding soulx-env/ and asr-env/), PROMPT (path without
# extension, default $HAFTARAH_AUDIO/prompts/vocalset-m6-dona), REF, KEY. One GPU job at a time.
set -u
REPO=$(cd "$(dirname "$0")/../../.." && pwd)
AUD=${HAFTARAH_AUDIO:-$HOME/haftarah-audio}
PROMPT=${PROMPT:-$AUD/prompts/vocalset-m6-dona}
REF=${REF:-I Samuel 20:18-19}
KEY=${KEY:-D3}
PY_SOULX=$AUD/soulx-env/venv/Scripts/python.exe; [ -x "$PY_SOULX" ] || PY_SOULX=$AUD/soulx-env/venv/bin/python
PY_ASR=$AUD/asr-env/Scripts/python.exe; [ -x "$PY_ASR" ] || PY_ASR=$AUD/asr-env/bin/python
name=$1; shift
out=$AUD/renders/ab/$name
mkdir -p "$out"
t0=$(date +%s)
(cd "$REPO" && node scripts/trope-render.mjs --ref "$REF" --key "$KEY" --prompt "$PROMPT.wav" --prompt-meta "$PROMPT.json" --out "$out" "$@") > "$out/render.log" 2>&1
t1=$(date +%s)
{
  echo "variant $name: $* (prompt $(basename "$PROMPT")) wall $((t1 - t0))s"
  "$PY_SOULX" "$REPO/trope/env/pitch_check.py" "$out" | tail -3
  "$PY_SOULX" "$REPO/trope/gap_check.py" "$out" | tail -3
  "$PY_ASR" -I "$REPO/trope/asr_cer.py" "$out" "$REPO/trope/env/ab/ref-text-i-samuel-20-18-42.json" --json "$out/asr.json" 2>/dev/null | tail -3
} > "$out/metrics.txt" 2>&1
cat "$out/metrics.txt"
