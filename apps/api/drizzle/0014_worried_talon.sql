CREATE INDEX "audit_event_target_id_index" ON "audit_event" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "audit_event_ip_index" ON "audit_event" USING btree ("ip");