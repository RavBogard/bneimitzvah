DROP INDEX learner_claim_active_key;
--> statement-breakpoint
CREATE UNIQUE INDEX learner_claim_active_key ON learner_claim (tenant_id, learner_membership_id, tutor_grant_id) WHERE revoked_at IS NULL;
