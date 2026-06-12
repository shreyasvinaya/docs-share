CREATE TABLE `drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`storage_path` text NOT NULL,
	`title` text NOT NULL,
	`source_filename` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`content_sha256` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `drafts_owner_idx` ON `drafts` (`owner_user_id`);
