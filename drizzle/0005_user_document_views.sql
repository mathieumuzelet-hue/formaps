CREATE TABLE "user_document_views" (
	"user_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"viewed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_document_views_user_id_document_id_pk" PRIMARY KEY("user_id","document_id")
);
--> statement-breakpoint
ALTER TABLE "user_document_views" ADD CONSTRAINT "user_document_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_document_views" ADD CONSTRAINT "user_document_views_document_id_formation_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."formation_documents"("id") ON DELETE cascade ON UPDATE no action;