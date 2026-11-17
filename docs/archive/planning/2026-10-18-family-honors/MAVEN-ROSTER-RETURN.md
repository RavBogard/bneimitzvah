# Maven roster read contract — 2026-10-18

The pure query builder and response decoder are ready for integration. They are not connected to Maven, an endpoint, a database write, the roster planner or a user interface.

The fixed Contact query preserves the exact source Contact ID and separate name columns. Its only variable inputs are validated ceremony-date bounds, with a maximum 1,830 inclusive days. It requests 501 rows to detect a roster beyond the 500-contact limit. Maven's lower source governor is accepted only when completeness and pagination independently account for all returned rows; a truncated response is rejected.

Decoded contact facts preserve contact email and household-primary-contact email as distinct provenance. Neither establishes guardianship. Student kind, service slot and guardianship remain unresolved; a recorded decision not to have a ceremony is retained as a readiness issue. No enrollment, identity linking, invitation, mail or grants occur. Facts are confidential and transient; only row indices and fixed issue codes are safe to return as errors.

The source contract was checked against Maven's governed `maven_run_soql` implementation, including recursive removal of Salesforce attributes, query provenance, completeness, pagination and privacy metadata. A normal query without a pastoral option produces nonpastoral metadata; financial permission is a principal flag and does not add fields to this fixed query. Lifecycle display feeds are unsuitable as an identity source because their projection drops the Contact ID.

Validation: 43 synthetic focused cases and isolated application typecheck passed. Cases include stable IDs, shared households, unresolved contact roles, duplicate IDs, partial responses, lower source limits, query drift, malformed rows, getters/proxies and resource bounds. No live source data was read. Repository protection and hosted integration checks are recorded with the checkpoint.

Next: establish the approved Maven connection and sufficient governed read capacity, then reconcile student kind, service slot and actual guardian relationships before proposing planner inputs. Do not infer these from names, household identity or email. Claude Code owns the corresponding frontend workflow; this checkpoint changes no frontend or backend authority.
