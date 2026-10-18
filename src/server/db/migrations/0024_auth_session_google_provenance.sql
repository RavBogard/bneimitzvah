ALTER TABLE "session" ADD COLUMN "google_authenticated_at" timestamp;
--> statement-breakpoint
CREATE TRIGGER immutable_session_google_authenticated_at
BEFORE UPDATE ON "session" FOR EACH ROW
EXECUTE FUNCTION portal_immutable_columns('google_authenticated_at');
