# havarotjs (vendored)

- Package: havarotjs 0.25.5, by Charles Loder. License: MIT (`LICENSE` in this folder, copied from the package).
- Source: npm registry tarball https://registry.npmjs.org/havarotjs/-/havarotjs-0.25.5.tgz
  (integrity `sha512-oYJcM0Qz++kVGYiSYSrfTGFuOqoThlF6OOfej1uplZ9YV6SqN12OuyIJK8GYt9QC0I+VbQnmz9LbnOZZiitXfA==`,
  tarball sha256 `796f2881f1e6d8a5e1034882e4fb8e2e1b431a0242b711b3a11c3af3a932a806`, gitHead `eda5f63864c423140879c1919b1b804322b93a96`).
  Project home: https://github.com/charlesLoder/havarotjs
- Fetched: 2026-10-15, with `npm pack havarotjs@0.25.5` in a scratch directory (never `npm install` in this repo).
- Copied: every `dist/**/*.js` file (pure ESM, ~120 KB), same relative paths. Not copied: `dist/**/*.d.ts`,
  `dist/**/*.js.map`, `README.md`, `package.json`. The `//# sourceMappingURL` comments at the end of each file
  therefore point at maps that are not here; that is harmless.
- Modified: nothing. The copied files are byte-identical to the tarball's (sha256 compared file by file).
- Added: `package.json` with `{"type":"module"}` (not from the package). The repo's root package.json has no
  `type`, so without it Node re-parses these ESM `.js` files with a MODULE_TYPELESS_PACKAGE_JSON warning.
- Runtime dependencies: none. `package.json` declares no `dependencies`, and every `import` in the dist is a
  relative path inside the dist (the one `"havarotjs"` string is in a doc comment).
- Used by: `trope/text.mjs` (`import { Text } from "./vendor/havarotjs/index.js"`).
- To update: `npm pack havarotjs@<version>` in a scratch directory, replace the `.js` files, re-run `npm test`, and
  update this note.
