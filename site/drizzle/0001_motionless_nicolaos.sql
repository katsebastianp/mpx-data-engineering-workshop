CREATE TABLE `workshop_participant_settings` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`repository_url` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workshop_completed_steps` (
	`owner_id` text NOT NULL,
	`step_id` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `step_id`)
);
