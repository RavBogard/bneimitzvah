import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";

const { startBuiltE2eServer } = await import(process.argv[2]);
const root = process.argv[3];
const port = Number(process.argv[4]);
let stop;
try {
  stop = await startBuiltE2eServer(root, port);
  const result = await (await fetch(`http://127.0.0.1:${port}`)).json();
  if (result.isolated !== true) throw new Error("Synthetic child environment was not isolated");
  const lifecycle = JSON.parse(await readFile(join(root, "lifecycle.json"), "utf8"));
  await stop();
  stop = undefined;
  let removed = false;
  try { await lstat(lifecycle.home); }
  catch (error) {
    if (error?.code === "ENOENT") removed = true;
    else throw new Error("Synthetic child home cleanup could not be checked");
  }
  if (!removed) throw new Error("Synthetic child home was retained");
  console.log("isolated child and cleanup verified");
} catch {
  process.exitCode = 1;
  console.error("Synthetic production browser isolation probe failed");
} finally {
  await stop?.();
}
