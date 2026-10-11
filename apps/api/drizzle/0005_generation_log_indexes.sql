CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "generation_started_at_index" ON "generation" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "generation_finished_at_index" ON "generation" USING btree ("finished_at");--> statement-breakpoint
CREATE INDEX "generation_duration_ms_index" ON "generation" USING btree ("duration_ms");--> statement-breakpoint
CREATE INDEX "generation_total_ms_index" ON "generation" USING btree ("total_ms");--> statement-breakpoint
CREATE INDEX "generation_queue_wait_ms_index" ON "generation" USING btree ("queue_wait_ms");--> statement-breakpoint
CREATE INDEX "generation_page_count_index" ON "generation" USING btree ("page_count");--> statement-breakpoint
CREATE INDEX "generation_size_index" ON "generation" USING btree ("size");--> statement-breakpoint
CREATE INDEX "generation_template_id_queued_at_index" ON "generation" USING btree ("template_id","queued_at");--> statement-breakpoint
CREATE INDEX "generation_status_queued_at_index" ON "generation" USING btree ("status","queued_at");--> statement-breakpoint
CREATE INDEX "generation_source_queued_at_index" ON "generation" USING btree ("source","queued_at");--> statement-breakpoint
CREATE INDEX "generation_filename_trgm_index" ON "generation" USING gin ("filename" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "generation_error_trgm_index" ON "generation" USING gin ("error" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "generation_request_id_trgm_index" ON "generation" USING gin ("request_id" gin_trgm_ops);