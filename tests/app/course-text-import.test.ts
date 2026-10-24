import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
// @ts-expect-error The operator script is plain JavaScript with no declarations.
import { COURSE_TEXT_PIN, CourseTextImportRefused, courseTextIdentity as scriptIdentity, importCourseText } from "../../scripts/import-course-text.mjs";
import { PUBLIC_COURSE_TEXT } from "../../src/server/service-course/pin";
import { courseTextIdentity, parsePublicCourseFeed } from "../../src/server/service-course/public-feed";
import { feedBytes, syntheticBuild, syntheticFeedValue, syntheticPins } from "../helpers/course-text";

// The operator import of the pinned public text (2.0 SC2): verified against the pin before it writes, one transaction, idempotent.
test("the script's pin and identity are the app's", () => {
  expect(COURSE_TEXT_PIN).toEqual(PUBLIC_COURSE_TEXT);
  expect(scriptIdentity(COURSE_TEXT_PIN)).toBe(courseTextIdentity(PUBLIC_COURSE_TEXT));
});

test("it imports a verified build once, refuses other bytes and a different active build, and touches nothing else", async () => {
  const client = new PGlite();
  try {
    await migrate(drizzle(client), { migrationsFolder: "src/server/db/migrations" });
    const build = syntheticBuild();
    const catalogBefore = (await client.query("select count(*)::int as n from service_catalog")).rows;
    // Bytes that are not the pin, a licensed pin or an unknown congregation write nothing.
    await expect(importCourseText(client, { bytes: build.bytes.slice(1), tenantId: "crc" }, build.pins)).rejects.toBeInstanceOf(CourseTextImportRefused);
    await expect(importCourseText(client, { bytes: build.bytes, tenantId: "crc" }, { ...build.pins, lane: "licensed" })).rejects.toBeInstanceOf(CourseTextImportRefused);
    await expect(importCourseText(client, { bytes: build.bytes, tenantId: "crc" }, { ...build.pins, artifactName: "dist-app" })).rejects.toBeInstanceOf(CourseTextImportRefused);
    await expect(importCourseText(client, { bytes: build.bytes, tenantId: "nobody" }, build.pins)).rejects.toThrow("no such congregation");
    await expect(importCourseText(client, { bytes: build.bytes, tenantId: "crc" })).rejects.toThrow("feed hash is not the pin");
    expect((await client.query("select count(*)::int as n from course_text_catalog")).rows).toEqual([{ n: 0 }]);

    expect(await importCourseText(client, { bytes: build.bytes, tenantId: "crc" }, build.pins)).toEqual({ changed: true, identity: courseTextIdentity(build.pins) });
    expect(await importCourseText(client, { bytes: build.bytes, tenantId: "crc" }, build.pins)).toEqual({ changed: false, identity: courseTextIdentity(build.pins) });
    const rows = (await client.query("select c.volume, c.identity, c.pins, c.feed_bytes, l.state from course_text_catalog c join course_text_lifecycle l on l.catalog_id = c.id")).rows as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ volume: "shabbat-shacharit", state: "active", pins: build.pins });
    // What it stored parses with the app's own reader.
    expect(parsePublicCourseFeed(new Uint8Array(rows[0].feed_bytes as Uint8Array), rows[0].pins).identity).toBe(rows[0].identity);

    const other = feedBytes({ ...syntheticFeedValue(), title: "Synthetic other build" });
    await expect(importCourseText(client, { bytes: other, tenantId: "crc" }, syntheticPins(other))).rejects.toThrow("a different build is active");
    expect((await client.query("select count(*)::int as n from course_text_catalog")).rows).toEqual([{ n: 1 }]);
    expect((await client.query("select count(*)::int as n from service_catalog")).rows).toEqual(catalogBefore);
  } finally { await client.close(); }
});
