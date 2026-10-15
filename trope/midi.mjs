// A minimal Standard MIDI File writer (format 0, one track) for auditioning a score JSON in any
// MIDI player. One note per score note; a lyric meta event (FF 05) carries each syllable's
// phonemes at its first note, so a player with a lyric view shows the text under the melody.

const PPQ = 480;   // ticks per quarter note; score durations are in quarters

// Variable-length quantity: 7 bits per byte, high bit set on all but the last.
function vlq(n) {
  const out = [n & 0x7f];
  while ((n >>= 7) > 0) out.unshift((n & 0x7f) | 0x80);
  return out;
}
const u32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const meta = (type, bytes) => [0xff, type, ...vlq(bytes.length), ...bytes];
const utf8 = s => [...new TextEncoder().encode(String(s))];

export function scoreToMidi(score, { channel = 0, velocity = 80 } = {}) {
  const usPerQuarter = Math.round(60_000_000 / (score.tempo || 96));
  // Absolute-time events; offs sort before ons at the same tick so repeated pitches re-strike.
  const evs = [];
  for (const e of score.events || []) {
    const on = Math.round(e.t * PPQ), off = Math.round((e.t + e.dur) * PPQ);
    if (e.lyric !== undefined) evs.push({ tick: on, order: 1, bytes: meta(0x05, utf8(e.lyric || "-")) });
    evs.push({ tick: on, order: 2, bytes: [0x90 | channel, e.midi & 0x7f, velocity] });
    evs.push({ tick: off, order: 0, bytes: [0x80 | channel, e.midi & 0x7f, 0] });
  }
  evs.sort((a, b) => a.tick - b.tick || a.order - b.order);

  const track = [
    ...[0, ...meta(0x03, utf8(score.ref || "trope"))],
    ...[0, ...meta(0x51, [(usPerQuarter >> 16) & 255, (usPerQuarter >> 8) & 255, usPerQuarter & 255])],
  ];
  let now = 0;
  for (const ev of evs) { track.push(...vlq(ev.tick - now), ...ev.bytes); now = ev.tick; }
  track.push(0, 0xff, 0x2f, 0x00);   // end of track

  const header = [0x4d, 0x54, 0x68, 0x64, ...u32(6), 0, 0, 0, 1, (PPQ >> 8) & 255, PPQ & 255];
  return Uint8Array.from([...header, 0x4d, 0x54, 0x72, 0x6b, ...u32(track.length), ...track]);
}
