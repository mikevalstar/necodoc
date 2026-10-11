CREATE TABLE "download_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid,
	"generation_id" uuid,
	"created_by" text,
	"expires_at" timestamp with time zone NOT NULL,
	"downloads" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "file" ALTER COLUMN "bytes" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "file" ADD COLUMN "storage" text DEFAULT 'db' NOT NULL;--> statement-breakpoint
ALTER TABLE "file" ADD COLUMN "key" text;--> statement-breakpoint
ALTER TABLE "download_link" ADD CONSTRAINT "download_link_file_id_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "download_link" ADD CONSTRAINT "download_link_generation_id_generation_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."generation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "download_link" ADD CONSTRAINT "download_link_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_location" CHECK (("file"."storage" = 'db' and "file"."bytes" is not null and "file"."key" is null) or ("file"."storage" <> 'db' and "file"."bytes" is null and "file"."key" is not null));