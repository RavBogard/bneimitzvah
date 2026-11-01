# Music card details (centralreform.live BET-6)

Daniel approved sending ceremony details to the music setlist's Beit Mitzvah card ("names can be in there", 2026-10-31). The receiver is live: centralreform.live PR #49, operation `details` on the existing fixed-CRC endpoint and credential.

## Decided here

- **What goes:** active students' names (first and last), the Torah and haftarah citations, and rehearsal dates. Never verse text, Hebrew names, contacts or notes.
- **Citation only when exact:** the union of the ceremony's confirmed verses for a kind becomes one citation ("Genesis 1:31–2:1", "1 Samuel 20:18–42") only when it is one contiguous run in one book. Otherwise that reference is left out. A wrong citation is worse than none.
- **No slot:** the portal knows only morning or Havdalah, which the music side already holds and labels itself.
- **Names the receiver would refuse** (digits, non-Latin letters, over 120 characters) are left out, and the dry run counts them. A ceremony with no sendable name is skipped.
- **When:** the service drain (the daily cron, and the after-write dispatch that follows portal student edits, creation, import and reading confirmation) sends a ceremony's details whenever their fingerprint changes. Only upcoming ceremonies already linked to a setlist are covered. MCP roster and setup edits reach the music card at the next daily drain.
- **Ordering:** `sentAt` is the send time, and never earlier than the previous accepted send plus 1 ms. A failed send is not recorded, so the next drain retries it.
- **Back-fill:** the first drain after enabling is the back-fill. The digest starts empty for every ceremony.
- **Gate:** sending is off unless `PORTAL_MUSIC_DETAILS_ENABLED=true`. `GET /api/internal/service-ecosystem/drain?details=dry-run`, with the cron credential, reports what is due: ceremony ids, dates and counts, no names. It sends and records nothing.

## Release steps

1. Apply migration 0057 (two nullable columns on `service_ceremony`) with the owner migration connection.
2. Merge and deploy. Nothing is sent yet.
3. Run the dry run and check the counts.
4. Set `PORTAL_MUSIC_DETAILS_ENABLED=true` in Production and redeploy. Then either call the drain once or wait for the 10:17 UTC cron. That run is the back-fill.
