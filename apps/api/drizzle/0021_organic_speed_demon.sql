ALTER TABLE "share_link" ADD COLUMN "views_since" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- Existing links counted views from when 0016 added the column (its journal time), not from their creation.
UPDATE "share_link" SET "views_since" = greatest("created_at", to_timestamp(1791762066.427));
