ALTER TABLE "user_formation_progress" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "user_formation_progress" CASCADE;--> statement-breakpoint
CREATE INDEX "formation_documents_formation_id_idx" ON "formation_documents" USING btree ("formation_id");--> statement-breakpoint
CREATE INDEX "news_status_published_at_idx" ON "news" USING btree ("status","published_at");--> statement-breakpoint
DROP TYPE "public"."progress_status";