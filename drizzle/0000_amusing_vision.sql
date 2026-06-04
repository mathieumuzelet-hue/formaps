CREATE TYPE "public"."formation_kind" AS ENUM('sharepoint', 'pdf');--> statement-breakpoint
CREATE TYPE "public"."progress_status" AS ENUM('not_started', 'in_progress', 'done');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('employee', 'admin');--> statement-breakpoint
CREATE TABLE "formation_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"formation_id" uuid NOT NULL,
	"title" text NOT NULL,
	"pages" integer NOT NULL,
	"size_label" text NOT NULL,
	"file_url" text NOT NULL,
	"is_new" boolean DEFAULT false NOT NULL,
	"order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "formations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"tag" text NOT NULL,
	"icon" text NOT NULL,
	"description" text NOT NULL,
	"kind" "formation_kind" DEFAULT 'sharepoint' NOT NULL,
	"sharepoint_url" text,
	"doc_count" integer DEFAULT 0 NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "formations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"bascule_date" date NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_formation_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"formation_id" uuid NOT NULL,
	"status" "progress_status" DEFAULT 'not_started' NOT NULL,
	"progress_percent" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_formation_progress_user_id_formation_id_unique" UNIQUE("user_id","formation_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"first_name" text NOT NULL,
	"role" "role" DEFAULT 'employee' NOT NULL,
	"store_id" uuid,
	"dify_conversation_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "formation_documents" ADD CONSTRAINT "formation_documents_formation_id_formations_id_fk" FOREIGN KEY ("formation_id") REFERENCES "public"."formations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_formation_progress" ADD CONSTRAINT "user_formation_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_formation_progress" ADD CONSTRAINT "user_formation_progress_formation_id_formations_id_fk" FOREIGN KEY ("formation_id") REFERENCES "public"."formations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE set null ON UPDATE no action;