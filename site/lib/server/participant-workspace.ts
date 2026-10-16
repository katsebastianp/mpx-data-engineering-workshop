import { and, eq, isNull, notExists } from "drizzle-orm";
import { getDb } from "../../db";
import { participantSettings, workshopRuns } from "../../db/schema";
import { participantWorkspaceFor, workspaceForParticipant, type ParticipantWorkspace } from "../participant";
import { participantBranchCandidates } from "../progress";

/** Allocate once from trusted profile data; later name changes keep the branch. */
export async function workspaceForAuthenticatedParticipant(user: { userId: string; fullName: string | null }): Promise<ParticipantWorkspace> {
  const identity = await participantWorkspaceFor(user.userId);
  const db = getDb();
  const active = await db.select({ name: participantSettings.activeRunName }).from(participantSettings).where(eq(participantSettings.ownerId, user.userId)).limit(1);
  if (active[0]?.name) {
    const runs = await db.select().from(workshopRuns).where(and(eq(workshopRuns.name, active[0].name), eq(workshopRuns.ownerId, user.userId))).limit(1);
    if (!runs.length) throw new Error("Active run unavailable");
    return workspaceForParticipant(identity.id, runs[0].name, runs[0].name);
  }
  const allocated = async () => {
    const rows = await db.select({ branchName: participantSettings.branchName }).from(participantSettings)
      .where(eq(participantSettings.ownerId, user.userId)).limit(1);
    return rows[0]?.branchName ?? null;
  };
  const existing = await allocated();
  if (existing) return workspaceForParticipant(identity.id, existing);

  for (const branchName of participantBranchCandidates(user.fullName, identity.id)) {
    try {
      await db.insert(participantSettings).values({ ownerId: user.userId, updatedAt: new Date().toISOString() }).onConflictDoNothing();
      const rows = await db.update(participantSettings).set({ branchName }).where(and(
        eq(participantSettings.ownerId, user.userId), isNull(participantSettings.branchName),
        notExists(db.select().from(workshopRuns).where(eq(workshopRuns.name, branchName))),
      )).returning({ branchName: participantSettings.branchName });
      const saved = rows[0]?.branchName ?? await allocated();
      if (saved) return workspaceForParticipant(identity.id, saved);
    } catch (error) {
      const detail = error instanceof Error ? `${error.message} ${error.cause instanceof Error ? error.cause.message : ""}` : "";
      if (!/UNIQUE constraint failed/i.test(detail)) throw error;
      // A different owner may have the same first name, or a concurrent request
      // for this account may have just won. Never rename an existing allocation.
      const saved = await allocated();
      if (saved) return workspaceForParticipant(identity.id, saved);
    }
  }
  throw new Error("Participant branch allocation unavailable");
}
