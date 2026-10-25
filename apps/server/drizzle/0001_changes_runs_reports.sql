CREATE TABLE `changes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`repo` text NOT NULL,
	`root_pr` integer NOT NULL,
	`tip_pr` integer NOT NULL,
	`input` text NOT NULL,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `changes_path_idx` ON `changes` (`owner_id`,`repo`,`root_pr`,`tip_pr`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`change_id` text NOT NULL,
	`run_id` text NOT NULL,
	`schema_version` integer NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`change_id`) REFERENCES `changes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reports_change_id_idx` ON `reports` (`change_id`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`change_id` text NOT NULL,
	`status` text NOT NULL,
	`progress` text,
	`error` text,
	`queued_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`change_id`) REFERENCES `changes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `runs_change_id_idx` ON `runs` (`change_id`);