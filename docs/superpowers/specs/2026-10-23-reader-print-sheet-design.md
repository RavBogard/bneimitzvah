# Reader's print sheet: design stub

Status: stub, 2026-10-23. Not yet designed in detail. The builder runs the full design pass (impeccable, ui-ux-pro-max, frontend-design) before writing code, and replaces this stub with the real spec.

## Settled decisions (Daniel, binding)

- **The feature (2026-10-23, verbatim):** "I want selecting a reading to do for this next Shabbat to be super easy. Including selectable and creatable from the MCP. I'm thinking through a use case where I want a printed sheet for me to have up for the Torah reading. It's got Hebrew-- I don't need a tikkun view-- and the English translation next to each other in columns. It needs to be really well thought out as a usable document. But it needs to be able to have all sorts of different formats because different people might want different things printed."
- **Skills:** the build uses the impeccable, ui-ux-pro-max and frontend-design skills.
- **Schedule:** queued after 1.4 and 1.5, no date. It is the second builder's work once 1.6 ships, in parallel with 1.6 or with voice, in place of the two-tenant groundwork.
- **Licence (2026-10-23, verbatim):** "JPS 2023 is fine in print." CRC's licence covers printed copies of JPS 2023, and each printed page carries the edition and its credit line. This supersedes the earlier reading that limited JPS 2023 to on-screen display. Never-in-repo is unchanged: no JPS text in the repository, fixtures or tests; tests use stand-in text.
- **Outdated comment:** the "English is never on the sheet" comment in `src/components/portal/workspace/study/practice-sheet.tsx` is now wrong. The builder corrects it.

## What this is

A printable document for a reader who will stand at the Torah: the Hebrew and the English side by side in columns, no tikkun view, laid out as a usable page rather than a screen dump. The default is the one Daniel described. Everything else is a format option.

The sheet is rendered by the browser's print CSS, as the family practice sheet is, with nothing rendered on a server unless the design pass finds a reason. Every page carries the translation's edition name and credit line, and the Sefaria credit where Sefaria text is used.

## Formats to design (all proposals, none approved)

Each is a setting on the sheet, with a sensible default. A format is a small named record, so the MCP and the page can share it.

- **Layout, default:** Hebrew and English in two columns, Hebrew on the right, verse by verse so each English verse sits beside its Hebrew verse. Proposal.
- **Hebrew only.** Proposal.
- **English only.** Proposal.
- **Hebrew script:** vowels and trope, vowels only, or consonants only. Proposal; Daniel's default is not stated.
- **English edition:** the translation to print, chosen from the editions the portal already shows with their licence. Default JPS 2023. Proposal.
- **Aliyah per page:** start each aliyah on a new page, or run on with a marker. Proposal.
- **Type size:** several steps, with the Hebrew larger than the English at each step, and a large-print step for reading at a distance. Proposal.
- **Verse numbers:** shown, hidden, or shown only at the start of each line group. Proposal.
- **Margin for notes:** a blank ruled or unruled column or wide outer margin. Proposal.
- **Page size:** US Letter or A4, portrait or landscape. Proposal.
- **Header and footer:** reading name, date or parasha, page number, and the edition credit. The credit line is required and cannot be turned off. Proposal.
- **Stand-up use:** extra line spacing and a heavier Hebrew weight for a sheet propped on the bimah. Proposal.
- **Saved formats:** a person can save a named format ("my Shabbat sheet") and reuse it. Proposal; the design pass decides whether this is account data or a link only.

Out of scope unless Daniel says otherwise: a tikkun layout (he does not want it here; the practice sheet already has one), commentary, and chant audio.

## Choosing the reading

"Super easy" is the test. The design pass starts from these proposals:

- The sheet opens already set to this coming Shabbat's reading, from the same calendar source the rest of the portal uses, with the format last used or the default.
- A person can change the reading to any parasha, any custom range, or one of their saved readings, from one control.
- One link or one print action produces the page; no steps in between.

## MCP tool (proposal)

One tool, in the portal's MCP server, that chooses a reading and returns a print link with the format baked in.

- Input: a reading (parasha name, a reference range, or a saved reading), defaulting to the coming Shabbat's reading when none is given; an optional format record as above.
- Output: a print link to the sheet in that format, plus a plain statement of the reading and format chosen, so the person can check it before printing.
- It reads and builds a link only. It does not return the translation text itself, so no licensed text passes through the tool result or a log.
- It works for a signed-in member under their own scope. Whether a signed-out use is allowed follows the portal's public-reading rule; the design pass confirms.
- Creating a saved format from the MCP is a second, separate write tool, if saved formats are built.

## Constraints the design pass must hold

- Never-in-repo: no JPS or other licensed text in the repo, fixtures or tests.
- The page works signed out for public readings, consistent with the show-rather-than-hide rule, unless the design pass finds a licence reason.
- Print output is checked in a real browser print preview on Windows and on a phone-to-printer path, at both paper sizes.
- `{productName}` is used wherever the product is named.

## Open items that wait on Daniel

None yet. The design pass may bring product wording for the format controls, which has no precedent; it asks then.
