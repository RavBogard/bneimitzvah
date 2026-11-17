# Quiet roster import return — 2026-10-17

## Current state

Implementation, independent review and local integration checks are complete on `codex/quiet-roster-import-current`, based on deployed `1d5e932`. Hosted CI is the remaining review-branch gate. No production migration, roster import, invitation issuance, email or deployment occurred. Daniel's private source files remain unchanged and ignored. The original checkout's ignore rule is committed as `09defb9`; the current-code privacy checkpoint is `adb635c`.

## Change

The importer retains exact five- and six-column formats and adds exact fourteen- and fifteen-column intake formats. Header validation compares parsed cells and their count, preventing a quoted merged header cell from silently dropping optional data. The strict existing client validators accept only the reviewed old or richer response shapes. The existing preview lists tutor-match outcomes and missing second-parent contacts; no new screen, navigation or design system was introduced.

Migration `0019_quiet_roster_intake` adds nullable Hebrew name, pending second guardian email and bounded, closed administrative intake metadata on `student`. Existing child/adult and slot migrations are reused. Intake stores parent names, household phone, display-only parashah, requested tutor name and pending match, and admin-only notes. Ordinary edits preserve the new fields when omitted. Non-admin student projections stay unchanged. Existing invitation checks now treat either parent contact as a parent contact throughout issue, reissue, review and acceptance. Import creates no guardian/tutor links, identities, grants or invitations.

Tutor matching is unique normalized-name matching against verified users with eligible existing tutor grants and active memberships in the current tenant. Unmatched or ambiguous names remain unassigned. Preview binds the relevant tutor snapshot; confirmation revalidates it. Scoped membership/grant locks follow the existing relationship lookup pattern and avoid target global-user locks. A saved match is only a proposal; assignment remains a separate explicit action.

## Private local dry-run

The actual full private file passed the real preview/confirm service through restricted runtime access against disposable local PGlite PostgreSQL. Results:

- 34 valid rows; 34 student rows and 34 import audit entries created; zero validation failures.
- Tutor outcomes: 0 matched, 20 unmatched, 0 ambiguous; 14 rows have no tutor name. This disposable fixture has no real tutor grants. No real tutor accounts were seeded to manufacture matches.
- Five rows lack a second guardian email; two also lack the name. Preview identifies all five incomplete rows.
- Every public table was counted before and after: only `student` and `audit_event` changed. Mail, network and reading-provider calls were all zero.
- All normalized contacts, labels, slot, Hebrew name and private notes were compared in memory and preserved. The supplied reading/slot corrections, per-record time in notes and withdrawn-student exclusions passed private checks. Both original source hashes were unchanged after the run. The disposable database was closed.

The private aggregate/detail evidence stays under the original checkout's ignored `.local-data/quiet-roster-review/`; it is not a tracked fixture or an invitation list. Tutor email addresses remain future inputs only on Daniel's explicit instruction.

## Verification

Focused author checks: 63 existing service/invitation/HTTP checks, 17 composed client/import/migration checks, and nine checks after the exact-header repair passed. Independent adversarial checks passed 5/5, including stale tutor preview, late-expiry atomic rollback, secondary-parent invitation transitions and non-admin projection. Privacy guard author checks passed 17/17 and independent new cases 2/2. Impeccable's detector reported no findings for the changed preview surface.

The PostgreSQL CI job's timeout increases from ten to fifteen minutes: the previous accepted run took 9m58s, and this checkpoint adds a migration and two browser cases. Independent diff review confirms that all commands, gates and service settings remain unchanged.

Root's local integration checks pass: **840 app tests plus one existing skip in 96 files**, **208 Node tests**, typecheck and production build. Actual restricted local PostgreSQL browser checks pass: the new desktop/mobile cases 2/2, then all seven existing roster controls after correcting one exact assertion for the intentionally expanded validation message. The first combined run was 8/9 solely because of that old literal; no product behavior was changed to pass it. Both exclusive helpers restored the temporary port source and removed their owned diagnostic roles. Root viewed the two synthetic captures together: the existing surface, new outcomes, responsive wrapping and confirmation remain usable without horizontal overflow. This is Chromium emulation, not a physical phone test.

First hosted [CI39006320425](https://github.com/RavBogard/bneimitzvah/actions/runs/39006320425) passed Linux, PostgreSQL and public browser jobs. Windows passed 208 Node and 838 app checks plus the existing skip, but an existing authentication test exceeded its 20-second aggregate budget; the next linking test returned 400. The aggregate created seven fresh migrated databases/RSA/SDK fixtures. Pinned runner source confirms timeout does not cancel its async body, making continued global JWKS-mock replacement a plausible cause of the next failure; the exact hosted interleaving was not captured. No product regression was established.

The bounded test-only repair splits the six verifier variants into named cases and the bad-signature case into its own test. Assertions, the 20-second default and all production deadlines are unchanged; existing cleanup now runs between fixtures. The final actual-Windows auth 16 plus roster 4 focused run passed 20/20 in 35.27 seconds, with individual verifier cases taking 1.635–1.925 seconds and the following positive linking case 3.459 seconds. Final typecheck passed after this repair. It adds six test cases without changing product code; the earlier local full-suite total therefore predates this test-only split. Independent diff review and staged protection precede replacement hosted CI.

Hosted CI is intentionally on the review branch; no main merge or production release is implied. Independent review: [INDEPENDENT-REVIEW.md](INDEPENDENT-REVIEW.md).

## Next action

Save the reviewed checkpoint and complete hosted CI. Production migration/import and later invitations remain separate actions; none is queued by this return. Claude's moving admin work remains independent and should reconcile only this frozen importer contract. Intake fields on the admin roster are `hebrewName`, `secondParentEmail` and closed `importMetadata`; preview adds `tutorMatches`, `missingSecondParentRows` and `tutorAssignmentsPending`. Preserve the closed old/rich response validators when reconciling Claude's current frontend.
