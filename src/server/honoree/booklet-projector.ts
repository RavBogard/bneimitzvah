import "server-only";
import type { ServiceFeed, ServiceUnit } from "../service-learning/feed";
import { material, unitPair, type GuestBlock } from "./recipient-material";

export const APPROVED_BOOKLET = Object.freeze({
  feedSha256: "8ea640e392a88dd4fee2825004b2db3c5d228025cf3685325dc709f7936c8266",
  provenanceSha256: "f046833c25cda7c153a6131d05425a388528ed60797b0fd84463adf5625f8978",
  identity: "781faabb7b219f76d684841fc91c9f13aecabc38b5cf5c7302144f5f80f41126",
  artifactRepo: "RavBogard/ShireiShabbat",
  artifactCommit: "edfef85e1e06737d5fea1c33970f23961f599fc5",
  artifactRunId: "35741258239",
  sourceGitSha: "edfef85-LICENSED",
  version: "crc-booklet-torah-blessings-v1",
});
const invalid = (): never => { throw new Error("Honoree unavailable"); };
function keys(value: object, allowed: readonly string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) return invalid();
}
function blocks(unit: ServiceUnit, runs: readonly number[]): readonly GuestBlock[] {
  keys(unit, ["id", "family", "name", "section", "blocks", "caption", "group", "printedFolio", "folios"]);
  if (unit.caption !== undefined && unit.caption !== "") return invalid();
  const result: GuestBlock[] = [], pending: string[] = [];
  for (const block of unit.blocks) {
    if (block.type === "stanza") {
      keys(block, ["type", "he", "bare", "folio", "phys"]);
      if (typeof block.he !== "string" || !block.he.length || !block.he.isWellFormed()) return invalid();
      pending.push(block.he);
    } else if (block.type === "english") {
      keys(block, ["type", "en", "folio", "phys"]);
      if (pending.length !== runs[result.length] || typeof block.en !== "string" || !block.en.length) return invalid();
      result.push({ he: pending.join("\n"), en: block.en }); pending.length = 0;
    } else return invalid();
  }
  if (pending.length || result.length !== runs.length) return invalid();
  return result;
}
/** Pure projection of an already validated, exactly pinned source. No authority or I/O. */
export function projectBooklet(feed: ServiceFeed, slot: "morning" | "havdalah") {
  if (slot !== "morning" && slot !== "havdalah") return invalid();
  if (feed.identity !== APPROVED_BOOKLET.identity || feed.schemaVersion !== 1 || feed.volume !== "legacy-beit-mitzvah" ||
    feed.source.gitSha !== APPROVED_BOOKLET.sourceGitSha || feed.source.lane !== "licensed" ||
    feed.artifact.repo !== APPROVED_BOOKLET.artifactRepo || feed.artifact.commit !== APPROVED_BOOKLET.artifactCommit || feed.artifact.runId !== APPROVED_BOOKLET.artifactRunId) return invalid();
  keys(feed.license, ["attribution", "spdx"]);
  const pair = unitPair(slot), family = slot === "morning" ? "bm-shacharit" : "bm-maariv";
  const selected = pair.map(id => {
    const matches = feed.units.filter(unit => unit.id === id);
    if (matches.length !== 1 || matches[0].family !== family) return invalid(); return matches[0];
  });
  return material({ version: APPROVED_BOOKLET.version, before: blocks(selected[0], [1, 1, 5]), after: blocks(selected[1], [5, 2]),
    credits: [feed.license.attribution, feed.license.spdx] });
}
