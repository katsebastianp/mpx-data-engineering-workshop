CREATE TABLE `workshop_run_steps` (
	`owner_id` text NOT NULL,
	`run_name` text NOT NULL,
	`step_id` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `run_name`, `step_id`)
);
--> statement-breakpoint
CREATE TABLE `workshop_runs` (
	`name` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`repository_url` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `workshop_participant_settings` ADD `active_run_name` text;