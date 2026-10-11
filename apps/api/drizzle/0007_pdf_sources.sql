CREATE TABLE "pdf_source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"pages" jsonb NOT NULL,
	"fields" jsonb NOT NULL,
	"encrypted" boolean NOT NULL,
	"xfa" boolean NOT NULL,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pdf_source" ADD CONSTRAINT "pdf_source_file_id_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdf_source" ADD CONSTRAINT "pdf_source_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;