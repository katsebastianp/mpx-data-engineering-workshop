import { eq, isNull } from "drizzle-orm";
import { getDb } from "../../db";
import { participantSettings } from "../../db/schema";
import { participantWorkspaceFor, workspaceForParticipant, type ParticipantWorkspace } from "../participant";
import { participantBranchCandidates } from "../progress";

/** Allocate once from trusted profile data; later name changes keep the branch. */
export async function workspaceForAuthenticatedParticipant(user: { userId: string; fullName: string | null }): Promise<ParticipantWorkspace> {
  const identity = await participantWorkspaceFor(user.userId);
  const db = getDb();
  const allocated = async () => {
    const rows = await db.select({ branchName: participantSettings.branchName }).from(participantSettings)
      .where(eq(participantSettings.ownerId, user.userId)).limit(1);
    return rows[0]?.branchName ?? null;
  };
  const existing = await allocated();
  if (existing) return workspaceForParticipant(identity.id, existing);

  for (const branchName of participantBranchCandidates(user.fullName, identity.id)) {
    try {
      const rows = await db.insert(participantSettings).values({
        ownerId: user.userId, branchName, updatedAt: new Date().toISOString(),
      }).onConflictDoUpdate({
        target: participantSettings.ownerId,
        set: { branchName },
        // Another request may already have allocated this owner's branch.
        setWhere: isNull(participantSettings.branchName),
      }).returning({ branchName: participantSettings.branchName });
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
