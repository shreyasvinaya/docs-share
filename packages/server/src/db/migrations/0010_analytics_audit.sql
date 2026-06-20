CREATE TABLE `view_events` (
	`id` text PRIMARY KEY NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`viewed_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`visitor_hash` text NOT NULL,
	`referrer` text,
	`user_agent` text
);
--> statement-breakpoint
CREATE INDEX `view_events_target_idx` ON `view_events` (`target_type`,`target_id`);
--> statement-breakpoint
CREATE INDEX `view_events_viewed_at_idx` ON `view_events` (`viewed_at`);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text,
	`metadata` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_log_actor_idx` ON `audit_log` (`actor_user_id`);
--> statement-breakpoint
CREATE INDEX `audit_log_target_idx` ON `audit_log` (`target_type`,`target_id`);
--> statement-breakpoint
CREATE INDEX `audit_log_created_at_idx` ON `audit_log` (`created_at`);
