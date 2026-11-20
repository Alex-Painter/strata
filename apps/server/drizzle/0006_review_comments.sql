CREATE TABLE `pr_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`change_id` text NOT NULL,
	`pr` integer NOT NULL,
	`path` text,
	`line` integer,
	`side` text NOT NULL,
	`body` text NOT NULL,
	`message_id` text,
	`commit_oid` text,
	`state` text NOT NULL,
	`url` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`change_id`) REFERENCES `changes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pr_comments_change_idx` ON `pr_comments` (`change_id`,`pr`);--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `reads` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `pr_reviews` ADD `event` text DEFAULT 'APPROVE' NOT NULL;