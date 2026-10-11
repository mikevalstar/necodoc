CREATE TABLE "notification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"actor_id" text,
	"template_id" uuid,
	"review_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_review" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"fingerprint" text NOT NULL,
	"base_version" integer,
	"note" text,
	"submitted_by" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"template_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_review_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"body" text,
	"author_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_test_case" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"name" text NOT NULL,
	"data" jsonb NOT NULL,
	"assertions" jsonb NOT NULL,
	"source" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "template_test_case_templateId_name_unique" UNIQUE("template_id","name")
);
--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_template_id_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_review_id_template_review_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."template_review"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_review" ADD CONSTRAINT "template_review_template_id_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_review" ADD CONSTRAINT "template_review_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_review" ADD CONSTRAINT "template_review_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_review" ADD CONSTRAINT "template_review_template_version_id_template_version_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."template_version"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_review_event" ADD CONSTRAINT "template_review_event_review_id_template_review_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."template_review"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_review_event" ADD CONSTRAINT "template_review_event_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_test_case" ADD CONSTRAINT "template_test_case_template_id_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_test_case" ADD CONSTRAINT "template_test_case_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_user_id_created_at_index" ON "notification" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "template_review_template_id_created_at_index" ON "template_review" USING btree ("template_id","created_at");--> statement-breakpoint
CREATE INDEX "template_review_status_index" ON "template_review" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "template_review_open_index" ON "template_review" USING btree ("template_id") WHERE "template_review"."status" in ('pending', 'changes_requested', 'approved');--> statement-breakpoint
CREATE INDEX "template_review_event_review_id_created_at_index" ON "template_review_event" USING btree ("review_id","created_at");