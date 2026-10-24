/**
 * The one public build the service course may show (2.0 SC2). Daniel, 2026-10-24: the course's prayer text comes from
 * CRC's own texts in the shireishabbat and shirei-tfilah repos, public lane only; the licensed Beit Mitzvah build never
 * enters the app. This is that public lane, pinned by hash in code, so no stored row and no operator can put any other
 * bytes in front of a learner without a reviewed change here.
 *
 * Source: the producer repo's own CI (RavBogard/ShireiShabbat, workflow build-siddur.yml), run 35741258239 at
 * edfef85e1e06737d5fea1c33970f23961f599fc5, artifact `shabbat-shacharit-edfef85` (id 10699992434): the per-volume PUBLIC
 * build, whose feed declares `printing.source.lane: "public"` and carries the public placeholder Mi Shebeirach. It is the
 * same run and commit as the app's licensed Beit Mitzvah pin (src/server/honoree/booklet-projector.ts), but a different
 * artifact: that one is `dist-app` and is never read here. The public mirror (RavBogard/shirei-tfilah) has no successful
 * build of this volume to pin (its sync run of b710706 failed), so the producer's public-lane artifact is the pinned build.
 *
 * No prayer text is in this file or anywhere in the repo: the bytes live only in the database (course_text_catalog),
 * imported by scripts/import-course-text.mjs and checked against this pin on every read (the bytes are hashed again on each server instance's first read).
 */
export const PUBLIC_COURSE_TEXT = Object.freeze({
  volume: "shabbat-shacharit",
  lane: "public",
  feedSha256: "aca598e7e6e202b7a64c9ef244f83b17b7f87cfa24265a5b99f5b19a65dc4e6b",
  artifactRepo: "RavBogard/ShireiShabbat",
  artifactCommit: "edfef85e1e06737d5fea1c33970f23961f599fc5",
  artifactRunId: "35741258239",
  artifactName: "shabbat-shacharit-edfef85",
  sourceGitSha: "edfef85",
} as const);
export type CourseTextPins = Readonly<{ volume: string; lane: "public"; feedSha256: string; artifactRepo: string; artifactCommit: string;
  artifactRunId: string; artifactName: string; sourceGitSha: string }>;
export const COURSE_TEXT_PIN_KEYS = Object.freeze(["volume", "lane", "feedSha256", "artifactRepo", "artifactCommit", "artifactRunId", "artifactName", "sourceGitSha"] as const);

/** The public volumes a course may read. A licensed or legacy volume (`legacy-*`, `crc-*`) is never one. */
export const PUBLIC_COURSE_VOLUMES: readonly string[] = Object.freeze(["shabbat-shacharit"]);
/** The credit the Read step shows (A7 `read.credit`, "Text: {volume}, {licence}."): the book family and its licence. */
export const PUBLIC_COURSE_CREDIT = Object.freeze({ title: "Shirei Tfilah", licence: "CC BY-NC-SA 4.0", spdx: "CC-BY-NC-SA-4.0" });
/** The mixed Mi Shebeirach, refused everywhere (src/lib/service-course/text.ts, REFUSED_UNIT). */
export { REFUSED_UNIT as REFUSED_COURSE_UNIT } from "../../lib/service-course/text";
