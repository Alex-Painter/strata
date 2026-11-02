CREATE TABLE `pr_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`change_id` text,
	`repo` text NOT NULL,
	`pr` integer NOT NULL,
	`login` text NOT NULL,
	`commit_oid` text NOT NULL,
	`url` text NOT NULL,
	`submitted_at` integer NOT NULL,
	FOREIGN KEY (`change_id`) REFERENCES `changes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `pr_reviews_pr_idx` ON `pr_reviews` (`owner_id`,`repo`,`pr`);