CREATE TABLE `assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`repo` text NOT NULL,
	`pr` integer NOT NULL,
	`change_id` text,
	`reasons` text NOT NULL,
	`active` integer NOT NULL,
	`error` text,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`change_id`) REFERENCES `changes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assignments_pr_idx` ON `assignments` (`owner_id`,`repo`,`pr`);--> statement-breakpoint
CREATE INDEX `assignments_change_id_idx` ON `assignments` (`change_id`);--> statement-breakpoint
ALTER TABLE `changes` ADD `origin` text DEFAULT 'added' NOT NULL;--> statement-breakpoint
ALTER TABLE `changes` ADD `queued_heads` text;