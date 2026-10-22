import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";

// Drizzle's migrator applies only migrations whose journal `when` is later than the last one applied, so a
// migration merged with an earlier `when` than one already on main would be skipped silently in production.
test("the migration journal is in strictly increasing order of position, number and timestamp, with each file present", async () => {
  const folder = new URL("../src/server/db/migrations/", import.meta.url);
  const journal = JSON.parse(await readFile(new URL("meta/_journal.json", folder), "utf8"));
  assert.ok(Array.isArray(journal.entries) && journal.entries.length > 0);
  let previous = null;
  for (const [i, entry] of journal.entries.entries()) {
    assert.equal(entry.idx, i, `entry ${i} has idx ${entry.idx}`);
    assert.match(entry.tag, /^\d{4}_[a-z0-9_]+$/);
    await access(new URL(`${entry.tag}.sql`, folder));
    if (previous) {
      assert.ok(Number(entry.tag.slice(0, 4)) > Number(previous.tag.slice(0, 4)), `${entry.tag} must be numbered after ${previous.tag}`);
      assert.ok(entry.when > previous.when, `${entry.tag} must be timestamped after ${previous.tag}; regenerate its journal time`);
    }
    previous = entry;
  }
});
