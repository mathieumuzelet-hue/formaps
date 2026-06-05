CREATE TABLE "chat_queries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"query" text NOT NULL,
	"answer" text NOT NULL,
	"conversation_id" text NOT NULL,
	"message_id" text NOT NULL,
	"user_id" uuid,
	"retrieval_score_max" real,
	"retrieval_count" integer NOT NULL,
	"has_relevant_source" boolean NOT NULL,
	"feedback" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chat_queries_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
ALTER TABLE "chat_queries" ADD CONSTRAINT "chat_queries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_queries_created_at_idx" ON "chat_queries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "chat_queries_has_relevant_source_idx" ON "chat_queries" USING btree ("has_relevant_source");--> statement-breakpoint
CREATE INDEX "chat_queries_feedback_idx" ON "chat_queries" USING btree ("feedback");