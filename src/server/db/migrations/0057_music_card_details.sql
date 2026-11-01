-- Music card details (centralreform.live contract BET-6): the fingerprint of the names, citations and rehearsal dates last accepted
-- for a ceremony, and that send's ordering fence. Additive nullable columns; portal_runtime's table-wide grant from 0025 covers them.
ALTER TABLE "service_ceremony" ADD COLUMN "details_digest" text;--> statement-breakpoint
ALTER TABLE "service_ceremony" ADD COLUMN "details_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "service_ceremony" ADD CONSTRAINT "service_ceremony_details_shape" CHECK (("service_ceremony"."details_digest" is null) = ("service_ceremony"."details_sent_at" is null) and ("service_ceremony"."details_digest" is null or "service_ceremony"."details_digest" ~ '^[0-9a-f]{64}$'));
