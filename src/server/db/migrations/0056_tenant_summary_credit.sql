-- The congregation's portion summary credit moves from a hard-coded CRC value to a nullable tenant column, so a fork credits its own rabbi.
-- Additive. No backfill here: an operator sets it (scripts/add-congregation-host.mjs --summary-credit, or --set-summary-credit-only),
-- and until then approving a non-import summary fails closed (the function returns NULL, which no stamped credit can equal).
-- The runtime role has SELECT on tenant and no UPDATE, so it can read the credit but never set it. The guard trigger is unchanged.
ALTER TABLE "tenant" ADD COLUMN "summary_credit" text;--> statement-breakpoint
ALTER TABLE "tenant" ADD CONSTRAINT "tenant_summary_credit" CHECK ("tenant"."summary_credit" is null or (public.portal_source_plain("tenant"."summary_credit", 240) and strpos("tenant"."summary_credit", '@') = 0));--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.portal_portion_summary_credit(tenant text) RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT t.summary_credit FROM public.tenant t WHERE t.id = portal_portion_summary_credit.tenant
$$;
