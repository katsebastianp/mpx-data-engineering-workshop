CREATE TABLE `leaderboard_submissions` (
	`team_key` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`entry` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leaderboard_one_team_per_owner` ON `leaderboard_submissions` (`owner_id`);