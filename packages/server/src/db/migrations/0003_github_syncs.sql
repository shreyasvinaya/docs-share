CREATE TABLE `github_syncs` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_id` text NOT NULL,
	`repo_url` text NOT NULL,
	`branch` text DEFAULT 'main' NOT NULL,
	`last_commit_sha` text,
	`last_synced_at` text,
	`status` text DEFAULT 'idle' NOT NULL,
	`error` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `repos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `github_syncs_repo_idx` ON `github_syncs` (`repo_id`);
--> statement-breakpoint
CREATE INDEX `github_syncs_status_idx` ON `github_syncs` (`status`);
