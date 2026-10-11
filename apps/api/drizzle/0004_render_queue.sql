CREATE TABLE "batch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text,
	"template_id" uuid,
	"template_version_id" uuid,
	"template_name" text NOT NULL,
	"version" integer NOT NULL,
	"total" integer NOT NULL,
	"request_id" text,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "setting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker" (
	"id" text PRIMARY KEY NOT NULL,
	"host" text NOT NULL,
	"pid" integer NOT NULL,
	"version" text NOT NULL,
	"role" text NOT NULL,
	"concurrency" integer NOT NULL,
	"running" integer NOT NULL,
	"event_loop_lag_ms" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_seen" timestamp with time zone NOT NULL
);
--> statement-breakpoint
DROP INDEX "generation_started_at_index";--> statement-breakpoint
DROP INDEX "generation_user_id_started_at_index";--> statement-breakpoint
ALTER TABLE "generation" ALTER COLUMN "input" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "generation" ALTER COLUMN "started_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "generation" ALTER COLUMN "duration_ms" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "generation" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "generation" ADD COLUMN "batch_row" integer;--> statement-breakpoint
ALTER TABLE "generation" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "generation" ADD COLUMN "queued_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "generation" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "generation" ADD COLUMN "queue_wait_ms" integer;--> statement-breakpoint
ALTER TABLE "generation" ADD COLUMN "total_ms" integer;--> statement-breakpoint
ALTER TABLE "generation" ADD COLUMN "timings" jsonb;--> statement-breakpoint
ALTER TABLE "generation" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "generation" ADD COLUMN "worker_id" text;--> statement-breakpoint
-- Rows from before the queue ran in-process: no wait, one attempt.
UPDATE "generation" SET "queued_at" = "started_at", "finished_at" = "started_at" + "duration_ms" * interval '1 millisecond', "queue_wait_ms" = 0, "total_ms" = "duration_ms", "attempts" = 1;--> statement-breakpoint
ALTER TABLE "batch" ADD CONSTRAINT "batch_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch" ADD CONSTRAINT "batch_template_id_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."template"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batch" ADD CONSTRAINT "batch_template_version_id_template_version_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."template_version"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setting" ADD CONSTRAINT "setting_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation" ADD CONSTRAINT "generation_batch_id_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batch"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generation_queued_at_index" ON "generation" USING btree ("queued_at");--> statement-breakpoint
CREATE INDEX "generation_user_id_queued_at_index" ON "generation" USING btree ("user_id","queued_at");--> statement-breakpoint
CREATE INDEX "generation_batch_id_batch_row_index" ON "generation" USING btree ("batch_id","batch_row");--> statement-breakpoint
CREATE INDEX "generation_unfinished_index" ON "generation" USING btree ("status") WHERE "generation"."status" in ('queued', 'running');