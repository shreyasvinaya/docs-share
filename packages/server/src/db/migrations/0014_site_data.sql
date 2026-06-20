CREATE TABLE `site_data_collections` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`collection` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `site_data_collections_target_name_idx` ON `site_data_collections` (`target_type`,`target_id`,`collection`);
--> statement-breakpoint
CREATE INDEX `site_data_collections_owner_idx` ON `site_data_collections` (`owner_user_id`);
--> statement-breakpoint
CREATE TABLE `site_data_records` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`collection` text NOT NULL,
	`fields` text NOT NULL,
	`visitor_hash` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `site_data_owner_idx` ON `site_data_records` (`owner_user_id`);
--> statement-breakpoint
CREATE INDEX `site_data_target_idx` ON `site_data_records` (`target_type`,`target_id`);
--> statement-breakpoint
CREATE INDEX `site_data_collection_idx` ON `site_data_records` (`target_type`,`target_id`,`collection`);
