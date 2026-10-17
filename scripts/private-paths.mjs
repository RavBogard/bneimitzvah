// Private benchmark material must never sit inside any Git working tree: not this checkout, not
// the shared portal checkout this worktree came from, and not any other repository where a
// routine `git add -A` could publish it. Both the lexical and the resolved ancestor chains are
// checked, so junctions and symlinks cannot hide a repository.
import { lstat, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

async function exists(path) {
  try { await lstat(path); return true; } catch (error) { if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return false; throw error; }
}
async function chainHasGit(start) {
  for (let dir = start; ; dir = dirname(dir)) {
    if (await exists(join(dir, ".git"))) return true;
    if (dirname(dir) === dir) return false;
  }
}
/** True when path, or the nearest existing ancestor it resolves through, lies in a Git working tree. */
export async function insideGitWorkingTree(path) {
  const lexical = resolve(path);
  if (await chainHasGit(dirname(lexical)) || await exists(join(lexical, ".git"))) return true;
  let probe = lexical;
  while (!(await exists(probe))) { const up = dirname(probe); if (up === probe) return false; probe = up; }
  return chainHasGit(await realpath(probe));
}
