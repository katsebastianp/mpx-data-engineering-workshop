import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "../../db";
import { participantSettings, workshopRuns, workshopRunSteps } from "../../db/schema";
import { ProgressError, type ProgressMutation } from "../progress";

/** A run name is a workspace label; authentication remains the ownership boundary. */
export async function selectWorkshopRun(ownerId: string, name: string | null, expected: string | null) {
  const db = getDb();
  const updatedAt = new Date().toISOString();
  if (name !== null) {
    // One atomic statement reserves the branch name across new and legacy runs.
    await db.run(sql`INSERT INTO workshop_runs (name, owner_id, updated_at)
      SELECT ${name}, ${ownerId}, ${updatedAt}
      WHERE NOT EXISTS (SELECT 1 FROM workshop_participant_settings WHERE branch_name = ${name})
      ON CONFLICT(name) DO NOTHING`);
    const rows = await db.select().from(workshopRuns).where(eq(workshopRuns.name, name)).limit(1);
    if (rows[0]?.ownerId !== ownerId) throw new ProgressError("That name is already in use. Choose another, such as leon-test2.", 409);
  }
  const rows = await db.update(participantSettings).set({ activeRunName: name, updatedAt }).where(and(
    eq(participantSettings.ownerId, ownerId),
    expected === null ? isNull(participantSettings.activeRunName) : eq(participantSettings.activeRunName, expected),
  )).returning({ name: participantSettings.activeRunName });
  if (!rows.length) throw new ProgressError("Your active run changed in another tab. Reload before saving.", 409);
}

export async function saveRunProgress(ownerId: string, runName: string, mutation: Exclude<ProgressMutation, { action: "run" }>) {
  const db = getDb();
  const updatedAt = new Date().toISOString();
  const ownsRun = and(eq(workshopRuns.ownerId, ownerId), eq(workshopRuns.name, runName));
  const touch = db.update(workshopRuns).set({ updatedAt }).where(ownsRun);
  if (mutation.action === "complete") {
    const write = mutation.completed
      ? db.insert(workshopRunSteps).values({ ownerId, runName, stepId: mutation.stepId, updatedAt }).onConflictDoNothing()
      : db.delete(workshopRunSteps).where(and(eq(workshopRunSteps.ownerId, ownerId), eq(workshopRunSteps.runName, runName), eq(workshopRunSteps.stepId, mutation.stepId)));
    await db.batch([write, touch]);
  } else if (mutation.action === "repository") {
    await db.update(workshopRuns).set({ repositoryUrl: mutation.repositoryUrl, updatedAt }).where(ownsRun);
  } else {
    const update = db.update(workshopRuns).set({ repositoryUrl: sql`coalesce(${workshopRuns.repositoryUrl}, ${mutation.repositoryUrl ?? null})`, updatedAt }).where(ownsRun);
    if (mutation.completedSteps.length) {
      await db.batch([db.insert(workshopRunSteps).values(mutation.completedSteps.map(stepId => ({ ownerId, runName, stepId, updatedAt }))).onConflictDoNothing(), update]);
    } else await update;
  }
}
