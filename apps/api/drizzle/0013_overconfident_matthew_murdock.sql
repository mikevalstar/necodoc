CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" text,
	"actor_name" text,
	"impersonator_id" text,
	"api_key_id" text,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"target_name" text,
	"before" jsonb,
	"after" jsonb,
	"details" jsonb,
	"ip" text,
	"user_agent" text,
	"request_id" text
);
--> statement-breakpoint
CREATE INDEX "audit_event_created_at_id_index" ON "audit_event" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "audit_event_actor_id_created_at_index" ON "audit_event" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_event_action_created_at_index" ON "audit_event" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "audit_event_target_type_target_id_created_at_index" ON "audit_event" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_event_actor_name_index" ON "audit_event" USING btree ("actor_name");--> statement-breakpoint
CREATE INDEX "audit_event_target_name_trgm_index" ON "audit_event" USING gin ("target_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "audit_event_actor_name_trgm_index" ON "audit_event" USING gin ("actor_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "audit_event_request_id_trgm_index" ON "audit_event" USING gin ("request_id" gin_trgm_ops);--> statement-breakpoint
-- ADR 0032: the audit log is append-only. A database owner can still disable this trigger.
CREATE FUNCTION "audit_event_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_event is append-only (%)', TG_OP USING ERRCODE = 'insufficient_privilege';
END
$$;--> statement-breakpoint
CREATE TRIGGER "audit_event_append_only" BEFORE UPDATE OR DELETE ON "audit_event" FOR EACH ROW EXECUTE FUNCTION "audit_event_append_only"();--> statement-breakpoint
CREATE TRIGGER "audit_event_no_truncate" BEFORE TRUNCATE ON "audit_event" FOR EACH STATEMENT EXECUTE FUNCTION "audit_event_append_only"();
