ALTER TABLE "generation" ADD COLUMN "subject" text;--> statement-breakpoint
CREATE INDEX "generation_subject_index" ON "generation" USING btree (lower("subject"));