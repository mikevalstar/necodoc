CREATE TABLE "api_key_minute" (
	"api_key_id" text NOT NULL,
	"minute" integer NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "api_key_minute_api_key_id_minute_pk" PRIMARY KEY("api_key_id","minute")
);
--> statement-breakpoint
ALTER TABLE "api_key_minute" ADD CONSTRAINT "api_key_minute_api_key_id_apikey_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."apikey"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- ADR 0048: limits become requests per hour, counted by api_key_minute; the plugin's limiter is off.
UPDATE "apikey" SET "rate_limit_max" = "rate_limit_max" * 60, "rate_limit_time_window" = 3600000, "rate_limit_enabled" = false;
