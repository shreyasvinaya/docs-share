CREATE TABLE `webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`url` text NOT NULL,
	`secret` text NOT NULL,
	`events` text DEFAULT '[]' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhooks_owner_idx` ON `webhooks` (`owner_user_id`);
--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`webhook_id` text NOT NULL,
	`event` text NOT NULL,
	`status` text NOT NULL,
	`response_code` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`webhook_id`) REFERENCES `webhooks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhook_deliveries_webhook_idx` ON `webhook_deliveries` (`webhook_id`);
