import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { entryProblems } from "../scripts/repo-policy.mjs";
import { HUMAN_TRACKS_FILE, HUMAN_TRACKS_REASON } from "../scripts/human-track-policy.mjs";

const raw = readFileSync(new URL("../" + HUMAN_TRACKS_FILE, import.meta.url), "utf8");
const catalog = JSON.parse(raw);
const karaite = catalog.find(track => track.voice === "rotem-cohen");
const finkel = catalog.find(track => track.voice === "josh-finkel" && track.passages?.length);
const check = (value, path = HUMAN_TRACKS_FILE) => entryProblems(path, typeof value === "string" ? value : JSON.stringify(value));
const refused = track => assert.ok(check([track]).includes(HUMAN_TRACKS_REASON));

test("only the exact reviewed path admits the bounded public catalog schema", () => {
  assert.deepEqual(check(raw), []);
  for (const path of [HUMAN_TRACKS_FILE.toUpperCase(), "nested/" + HUMAN_TRACKS_FILE]) {
    assert.ok(check([karaite], path).includes("data file outside reviewed allow-list"));
  }
  assert.ok(check([karaite, karaite]).includes(HUMAN_TRACKS_REASON));
  const duplicate = JSON.stringify([karaite]).replace('{"id":', '{"id":"hidden payload","id":');
  assert.ok(check(duplicate).includes(HUMAN_TRACKS_REASON));
});

test("the approved recordings lane refuses unreviewed text and source fields", () => {
  refused({ ...karaite, notes: "synthetic private notes" });
  refused({ ...karaite, title: "Synthetic private title" });
  refused({ ...karaite, streamUrl: karaite.streamUrl + "?secret=1" });
  refused({ ...karaite, streamUrl: karaite.streamUrl.replace("karaites.org", "example.test") });
  refused({ ...finkel, audioPath: "https://example.test/example.mp3" });
  refused({ ...finkel, title: "Synthetic label · Chant" });
  refused({ ...finkel, passages: [{ ...finkel.passages[0], endVerse: 900 }] });
  refused({ ...finkel, passages: [{ ...finkel.passages[0], text: "synthetic" }] });
});
