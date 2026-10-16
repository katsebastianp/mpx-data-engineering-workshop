import { primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { StoredLeaderboardEntry } from "../lib/competition";

// Historical column names are retained to preserve deployed data. New storage
// keys are opaque, and the unique authenticated owner controls every upsert.
export const submissions = sqliteTable("leaderboard_submissions", {
  teamKey: text("team_key").primaryKey(),
  ownerId: text("owner_id").notNull(),
  entry: text("entry", { mode: "json" }).$type<StoredLeaderboardEntry>().notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("leaderboard_one_team_per_owner").on(table.ownerId)]);

// Each participant owns an independent checklist. Identity is supplied only
// by the Sites authentication boundary; checklist rows contain no profile data.
export const workshopCompletedSteps = sqliteTable("workshop_completed_steps", {
  ownerId: text("owner_id").notNull(),
  stepId: text("step_id").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [primaryKey({ columns: [table.ownerId, table.stepId] })]);

export const participantSettings = sqliteTable("workshop_participant_settings", {
  ownerId: text("owner_id").primaryKey(),
  repositoryUrl: text("repository_url"),
  branchName: text("branch_name"),
  activeRunName: text("active_run_name"),
  updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("workshop_unique_branch_name").on(table.branchName)]);


export const workshopRuns = sqliteTable("workshop_runs", {
  name: text("name").primaryKey(),
  ownerId: text("owner_id").notNull(),
  repositoryUrl: text("repository_url"),
  updatedAt: text("updated_at").notNull(),
});

export const workshopRunSteps = sqliteTable("workshop_run_steps", {
  ownerId: text("owner_id").notNull(),
  runName: text("run_name").notNull(),
  stepId: text("step_id").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [primaryKey({ columns: [table.ownerId, table.runName, table.stepId] })]);
