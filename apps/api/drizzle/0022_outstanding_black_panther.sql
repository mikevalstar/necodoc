CREATE TABLE "template_thumbnail" (
	"template_id" uuid PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"image" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "template_thumbnail" ADD CONSTRAINT "template_thumbnail_template_id_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."template"("id") ON DELETE cascade ON UPDATE no action;