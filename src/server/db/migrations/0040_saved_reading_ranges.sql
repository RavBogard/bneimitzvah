-- Release 1.7 M2 ("Change verses", PLAN-1-7): a member revises the verses of their own saved reading. The runtime may now
-- update the reading's ranges and the verse count the server recomputes from them; nothing else widens. Ownership, tenant and
-- kind still never change, there is still no table-level UPDATE, and the forced owner_only policy from 0036 limits every
-- update to the owner's own rows. The 0036 CHECKs (canonical ranges shape, at most 32 groups, 1-1000 verses) hold on update.
-- Translations, notes and marks are keyed by reading and verse, so a verse a revision drops keeps them and they return with it.
GRANT UPDATE (ranges, verse_count) ON saved_reading TO portal_runtime;
