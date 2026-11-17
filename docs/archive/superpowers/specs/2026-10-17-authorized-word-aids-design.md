# Authorized Hebrew word-aid delivery

## Settled decisions (Daniel, binding)

No transliteration. Hebrew syllables/stress and word meanings/grammar are 1.0 study tools. Existing reference playback comes first; generated voices are excluded and student recording work remains parked. This bounded milestone delivers the accepted numeric syllable/stress guide through existing study authorization. It adds no screen, provider, database migration or lexical corpus.

## Root's architecture contract

Add `createStudyWordAidsService` under `src/server/study/word-aids-service.ts`, composed with the existing `createStudyService` generic loader. Load canonical text and compute the guide inside that loader, before the existing second authorization pass. Require the first returned verse to match the assigned verse at the requested offset. Preserve the original request/selection snapshot, final assignment/student/grant/guardian/session/context bindings and abort/expiry checks. Do not change the access/practice/study authorization services or compute protected output after their final check.

Expose GET `/api/students/:id/study-word-aids` through the existing portal dispatcher. Accept precisely the existing study query keys and mode/kind/assignment/revision/translation/offset validation. No arbitrary reference, URL, asset or caller-supplied text. The child-practice header is permitted only through the existing capability path. Retain private/no-store headers, method gates, fixed errors and stale-revision behavior.

The successful outer response contains only `studentId`, `studentRevision`, `mode`, `context`, `assignment` and `wordAids`. Use explicit closed projection of the already reviewed `study-word-aids/v1` contract. Do not serialize StudyPage, Hebrew text, translation, engine units, warnings, raw errors or internal actor/session bindings. A legitimate closed analysis-unavailable guide is a successful authorized response; failed text loading or mismatched target is unavailable through the existing fixed error semantics. Do not fabricate a ready guide or hash. No new response/cache persistence.

Wire the service into existing runtime composition using the same text loader as study/reference playback. Keep the pure word-aid adapter and parser, engine, packages, schema and reference player unchanged. Update only required runtime fixtures. This checkpoint does not add the browser fetcher/panel; later client integration must independently hash the actual rendered canonical NFC reading text and parse against its actual ref/words, with existing scope/generation/abort fences and a bounded envelope that accommodates the 128KiB guide.

## Ownership and acceptance

Sol A owns the new service, narrow HTTP/runtime wiring, author tests and necessary fixture updates. Sol B owns a separate independent review/test file and reports defects for A to repair. Workers share the checkout and preserve each other's changes; no recursive delegation. Root owns architecture, integration, checkpoint and deployment.

Focused acceptance covers actual SDK authority for authorized modes; parent versus child-practice context; stale assignment before text I/O; assignment/student/grant/guardian/session/context changes while loading; abort and expiry before delivery; wrong target reference; numeric-only projection; strict methods/query and private headers. Preserve existing projection/parser tests. Run focused tests, typecheck and repository protection; root runs required broader integration gates after independent acceptance. Tests use synthetic data and isolated spawning environments. No real roster, corpus, mail, provider or production operation belongs to this assignment.

## Open items that wait on Daniel

None for this authorization seam. Source listening acceptance and later linguistic review remain distinct from transport and authorization evidence.
