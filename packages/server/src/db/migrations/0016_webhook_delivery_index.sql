ALTER TABLE `view_events` ADD `dedupe_key` text;--> statement-breakpoint
CREATE INDEX `view_events_dedupe_idx` ON `view_events` (`target_type`,`target_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `webhook_deliveries_webhook_created_idx` ON `webhook_deliveries` (`webhook_id`,`created_at`);
