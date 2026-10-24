# Curated discussions and credited Claude translations (1.7 M6)

## Settled decisions (Daniel, binding)

- **Approved direction.** MISSION "Amended 2026-10-23, Friday preparation direction", and CLAUDE-HANDOFF "Occasional curation through MCP" with acceptance check 8.
- **Source-only, rare, through MCP.** The rabbi names a question or theme and works with Claude to select original sources. MCP is the only authoring route, and the app has no guide editor or question builder.
- **No introductions, connecting essays or generated synthesis.** A discussion holds:
  - a question or title;
  - ordered original source passages, in English;
  - attribution.
- **Available to everyone.** Signed-out readers can see it. It publishes no private preparation.
- **Two entrances:**
  - beside its verses;
  - an optional list of questions, shown only where material exists. No portion is required to have one.
- **Claude translations.** "Any original" (2026-10-23 popup).
- **Wording** (2026-10-24 popups):
  - The credit is "Claude translation for {productName}".
  - The person who selected the source appears in the source details, not in the credit line.
  - The labels are "Sources on this verse" (the marker beside a verse), "Sources for this reading" (the list under the reading header) and "Back to this verse".
- **Print** (2026-10-24 popup): "Yes, under the licence filter (Recommended)". Discussions may join the print commentary appendix:
  - Claude translations print with their credit;
  - Sefaria sources in a discussion print only if their edition passes the M5 filter (public domain, CC0, CC BY, CC BY-NC).
- **Existing student guides stay as they are.** They are the secondary exception, not the model for this feature.

## Decided here (Claude, logged)

- **GATE: adding through MCP publishes at once.** This is like Learn lesson text (1.5 ruling 7), and fixes come by revising or withdrawing. Proceeded because the handoff says curation is the rabbi's own act through Claude, and a review queue would be the guide-authoring product it rules out.
- **Source text comes from Sefaria live**, with edition, licence and credit, exactly as the Study lens does. The database stores references, never Sefaria text.
- **Claude translations are stored in the database**, never in the repo. They are our own text.
- **A translation is bound to one exact original reference** and one Hebrew or Aramaic edition. Changing it makes a new revision, and a translation is never edited in place.
- **Withdraw, don't delete.** A withdrawn discussion disappears from both entrances, and its rows stay.
- **Admins only, attended connections only.** This matches the voice and guide tools, so an unattended routine is never allowed.
- **Print.** A discussion appears in the appendix as its own group, after the commentary grouped by verse, under its own title. It appears only when the reader chooses it in the appendix options.

## Data (migration 0042, owner pattern from 0027 and 0036)

- **`curated_discussion`:**
  - fields: `tenant_id`, `id`, `slug` (unique per tenant), `title` (plain text, ≤ 160 bytes), `kind` (`torah` or `haftarah`), `status` (`published` or `withdrawn`), `selected_by` (membership id), `revision`, timestamps;
  - RLS is forced, with tenant isolation;
  - the runtime role may SELECT, INSERT, and UPDATE only `(title, status, revision, updated_at)`. There is no DELETE.
- **`curated_discussion_source`:**
  - fields: `tenant_id`, `discussion_id`, `position` (1–24), `ref` (Sefaria ref), `anchor_ref` (one verse of the reading, `VERSE_REF`), plus exactly one of `edition` (Sefaria version title) or `translation_id`;
  - each revision replaces the whole ordered set.
- **`source_translation`:**
  - fields: `tenant_id`, `id`, `original_ref`, `original_edition`, `body` (markdown-lite, ≤ 16 KB, the same rules as guide prose: no links, no HTML, no hidden characters), `selected_by`, `created_at`;
  - it is insert-only.
- **Public reads** go through a security-definer function or view that returns only `published` rows and their sources, never `selected_by`'s membership id. Only the display name is shown in the credit.

## Server

- **Admin MCP tools** (scope write, attended, admin grant):
  - `add_discussion` takes `{ title, kind, sources: [{ ref, anchorRef, edition? | translationId? }] }`. It validates every ref and edition against Sefaria, checks each `anchorRef` is a verse of a real reading, and publishes.
  - `revise_discussion` takes `{ slug, revision, title?, sources? }`.
  - `withdraw_discussion` takes `{ slug, revision }`.
  - `list_discussions` takes a reading or verse and returns everything, including withdrawn.
  - `add_source_translation` takes `{ originalRef, originalEdition, body }` and returns `{ translationId, credit }`.
  - Every tool refuses input carrying anything from saved readings, notes or student data. They take only explicit text and references.
- **Public route** `GET /api/public/discussions?reading=<key>|ref=<passage>`:
  - It is cacheable (`s-maxage`, stale-while-revalidate) and has the same shape for signed-in and signed-out readers.
  - It returns discussions whose anchors fall in the passage: title, slug, and the ordered sources with their anchors and credits.
  - Source text is fetched through the existing Study commentary path.
- **Idempotency.** `add_*` accepts a `mutationId`, unique per tenant, so a retry doesn't make a duplicate.

## UI

- **Beside the verse.** In Study, a verse with a discussion anchored to it shows one quiet marker. It opens a `"discussion"` kind in `VersePanelScope`: the title, then each source in order, with its full text, credit and a link to its original context. It follows the existing "back to everything on this verse" pattern, and Esc returns focus.
- **Question list.** On /read and in the signed-in reading, a small list appears under the reading header only when a discussion exists for the passage. Each item opens the discussion at its first anchor.
- **Credit:** "Claude translation for {productName}". It is shown wherever the translation appears, in the same place an edition credit goes. The source details add "Selected by {name}".
- **Labels:** the marker's accessible name is "Sources on this verse", the list heading is "Sources for this reading", and the way back is "Back to this verse". They sit behind named constants.

## Tests

- **Migration and RLS:**
  - public reads see only published rows;
  - no tenant can see another's rows;
  - the runtime can't DELETE, and can't UPDATE `selected_by` or `body`;
  - a translation is never mutated.
- **Validation:**
  - no intro or essay field is accepted;
  - text with links or HTML is refused;
  - a bad ref or edition is refused;
  - an anchor outside its reading is refused.
- **MCP:**
  - only admins can use the tools, and unattended connections are refused;
  - a repeated `mutationId` doesn't create a duplicate;
  - a stale revision is refused.
- **Public route:**
  - cache headers are set;
  - withdrawn discussions are hidden;
  - the output never contains `selected_by` or an email address.
- **UI:**
  - the marker appears only where a discussion exists;
  - the list is hidden when there is nothing to show;
  - Esc returns focus.
- An adversarial review, because this is a new public write path and a migration.

## Open items that wait on Daniel

- "Selected by {name}" in the source details is a short, literal label that follows his choice of credit. Confirm it at the v1.7.x check-in.
