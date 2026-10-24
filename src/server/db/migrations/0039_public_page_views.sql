CREATE TABLE "public_page_view_day" (
	"tenant_id" text NOT NULL,
	"day" date NOT NULL,
	"path" text NOT NULL,
	"views" integer NOT NULL,
	CONSTRAINT "public_page_view_day_key" PRIMARY KEY("tenant_id","day","path"),
	CONSTRAINT "public_page_view_day_path" CHECK (char_length("public_page_view_day"."path") between 2 and 96 and "public_page_view_day"."path" ~ '^(/[a-z0-9]+(-[a-z0-9]+)*)+$'),
	CONSTRAINT "public_page_view_day_views" CHECK ("public_page_view_day"."views" > 0),
	CONSTRAINT "public_page_view_day_day" CHECK (isfinite("public_page_view_day"."day"))
);
--> statement-breakpoint
ALTER TABLE "public_page_view_day" ADD CONSTRAINT "public_page_view_day_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Release 1.5 cookieless analytics (Daniel: "path and day only"). Tenant-isolated like every congregation table. A row is a
-- congregation, a UTC day, an allow-listed public path and a count; nothing about a visitor. The public beacon route adds one
-- with an upsert (INSERT, then UPDATE of views alone); an admin MCP tool reads. No DELETE and no TRUNCATE for the runtime.
ALTER TABLE public_page_view_day ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public_page_view_day FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public_page_view_day FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON public_page_view_day FROM portal_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT ON public_page_view_day TO portal_runtime;
--> statement-breakpoint
GRANT UPDATE (views) ON public_page_view_day TO portal_runtime;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON public_page_view_day TO portal_runtime USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), ''));
