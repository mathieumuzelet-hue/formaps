UPDATE "users" SET "email" = lower(trim("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_idx" ON "users" USING btree (lower("email"));--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_name_unique" UNIQUE("name");