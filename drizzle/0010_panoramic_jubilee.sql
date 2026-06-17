CREATE TYPE "public"."dify_source_type" AS ENUM('faq_draft', 'formation_doc');--> statement-breakpoint
CREATE TYPE "public"."dify_sync_status" AS ENUM('pending', 'synced', 'failed');--> statement-breakpoint
CREATE TABLE "dify_sync" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_type" "dify_source_type" NOT NULL,
	"source_id" uuid NOT NULL,
	"dataset_id" text NOT NULL,
	"dify_document_id" text,
	"status" "dify_sync_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "dify_sync_source_unique" ON "dify_sync" USING btree ("source_type","source_id");