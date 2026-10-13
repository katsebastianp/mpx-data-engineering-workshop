ALTER TABLE `workshop_participant_settings` ADD `branch_name` text;--> statement-breakpoint
CREATE UNIQUE INDEX `workshop_unique_branch_name` ON `workshop_participant_settings` (`branch_name`);