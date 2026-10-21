# Service ecosystem implementation

1. Persist approved scope; agree source broker contract with Astra/source owner.
2. Add migration 0025 for durable ceremony scheduling/link state, stable parts and individual assignments/requests. Enqueue only new or explicitly edited future schedules; no roster backfill.
3. Implement narrow access service, projection/refresh and request handling. Connect manual creation/edit and quiet intake. Failure preserves roster; idempotent retries preserve setlists and student work.
4. Integrate My service and staff connection/assignment/request controls with existing Annotated score components and material feed.
5. Verify synthetic scheduling/import/idempotency, tenant and guardian authorization, resource revocation, progress preservation and source failure behavior; run required repository checks.
6. Commit coherent checkpoints. Update RETURN and obtain independent adversarial review before integration/release. No deployment or merge in this assignment.
