import { and, eq, sql } from "drizzle-orm";
import { chatGPTSignInPath, chatGPTSignOutPath, getChatGPTUser, type ChatGPTUser } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { participantSettings, workshopCompletedSteps, workshopRuns, workshopRunSteps } from "../../../db/schema";
import { workshopExercises } from "../../../components/workshop-content";
import { assertProgressWriteContext, ProgressError, readProgressMutation, type AuthenticatedProgress, type ProgressResponse } from "../../../lib/progress";
import { workspaceForAuthenticatedParticipant } from "../../../lib/server/participant-workspace";

import { selectWorkshopRun, saveRunProgress } from "../../../lib/server/workshop-runs";

export const dynamic = "force-dynamic";
const responseHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const stepIds = new Set(workshopExercises.map((exercise) => exercise.id));
const signInUrl = chatGPTSignInPath("/workshop");

async function progressFor(user: ChatGPTUser): Promise<AuthenticatedProgress> {
  const db = getDb();
  const workspace = await workspaceForAuthenticatedParticipant(user);
  const availableRuns = await db.select({ name: workshopRuns.name }).from(workshopRuns).where(eq(workshopRuns.ownerId, user.userId)).orderBy(workshopRuns.name);
  const [steps, settings] = workspace.runName ? await Promise.all([
    db.select({ stepId: workshopRunSteps.stepId, updatedAt: workshopRunSteps.updatedAt }).from(workshopRunSteps).where(and(eq(workshopRunSteps.ownerId, user.userId), eq(workshopRunSteps.runName, workspace.runName))),
    db.select({ repositoryUrl: workshopRuns.repositoryUrl, updatedAt: workshopRuns.updatedAt }).from(workshopRuns).where(and(eq(workshopRuns.ownerId, user.userId), eq(workshopRuns.name, workspace.runName))).limit(1),
  ]) : await Promise.all([
    db.select({ stepId: workshopCompletedSteps.stepId, updatedAt: workshopCompletedSteps.updatedAt }).from(workshopCompletedSteps).where(eq(workshopCompletedSteps.ownerId, user.userId)),
    db.select({ repositoryUrl: participantSettings.repositoryUrl, updatedAt: participantSettings.updatedAt }).from(participantSettings).where(eq(participantSettings.ownerId, user.userId)).limit(1),
  ]);
  const completed = new Set(steps.map((row) => row.stepId));
  return {
    authenticated: true,
    account: { subject: user.userId, displayName: user.displayName, email: user.email },
    workspace,
    availableRuns: availableRuns.map(row => row.name),
    completedSteps: workshopExercises.filter((exercise) => completed.has(exercise.id)).map((exercise) => exercise.id),
    repositoryUrl: settings[0]?.repositoryUrl ?? null,
    updatedAt: [settings[0]?.updatedAt, ...steps.map((row) => row.updatedAt)].filter((value): value is string => Boolean(value)).sort().at(-1) ?? null,
    signOutUrl: chatGPTSignOutPath("/workshop"),
  };
}

function errorResponse(error: unknown, operation: string) {
  if (error instanceof ProgressError) {
    console.warn(`progress.${operation}_rejected`, { status: error.status });
    return Response.json({ error: error.message }, { status: error.status, headers: responseHeaders });
  }
  // Database failures can include query values. Log only the error class.
  console.error(`progress.${operation}_failed`, { kind: error instanceof Error ? error.name : "unknown" });
  return Response.json({ error: "Your progress is temporarily unavailable. Please try again shortly." }, { status: 503, headers: responseHeaders });
}

export async function GET() {
  try {
    const user = await getChatGPTUser();
    const payload: ProgressResponse = user ? await progressFor(user) : { authenticated: false, signInUrl };
    return Response.json(payload, { headers: responseHeaders });
  } catch (error) { return errorResponse(error, "read"); }
}

export async function PATCH(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return Response.json({ error: "Sign in with ChatGPT to save your own workshop progress.", signInUrl }, { status: 401, headers: responseHeaders });
    assertProgressWriteContext(request, user.userId);
    const mutation = await readProgressMutation(request, stepIds);
    const workspace = await workspaceForAuthenticatedParticipant(user);
    if ((request.headers.get("x-workshop-run") || null) !== workspace.runName) throw new ProgressError("Your active run changed. Reload before saving.", 409);
    if (mutation.action === "run") {
      await selectWorkshopRun(user.userId, mutation.name, workspace.runName);
      console.info("progress.run_selected");
      return Response.json(await progressFor(user), { headers: responseHeaders });
    }
    if (workspace.runName) {
      await saveRunProgress(user.userId, workspace.runName, mutation);
      console.info("progress.run_saved", { action: mutation.action });
      return Response.json(await progressFor(user), { headers: responseHeaders });
    }
    const db = getDb();
    const updatedAt = new Date().toISOString();
    const ownerId = user.userId;
    const touchSettings = db.insert(participantSettings).values({ ownerId, updatedAt })
      .onConflictDoUpdate({ target: participantSettings.ownerId, set: { updatedAt } });

    if (mutation.action === "complete") {
      // Each write targets one user's one step, preserving simultaneous updates
      // to other steps and preventing stale browser snapshots from clearing them.
      const stepMutation = mutation.completed
        ? db.insert(workshopCompletedSteps).values({ ownerId, stepId: mutation.stepId, updatedAt }).onConflictDoNothing()
        : db.delete(workshopCompletedSteps).where(and(eq(workshopCompletedSteps.ownerId, ownerId), eq(workshopCompletedSteps.stepId, mutation.stepId)));
      await db.batch([stepMutation, touchSettings]);
    } else if (mutation.action === "repository") {
      await db.insert(participantSettings).values({ ownerId, repositoryUrl: mutation.repositoryUrl, updatedAt })
        .onConflictDoUpdate({ target: participantSettings.ownerId, set: { repositoryUrl: mutation.repositoryUrl, updatedAt } });
    } else {
      // Import unions old browser checkmarks into this account. An established
      // server-side repository always wins over the optional imported link.
      const importSettings = db.insert(participantSettings).values({ ownerId, repositoryUrl: mutation.repositoryUrl ?? null, updatedAt })
        .onConflictDoUpdate({ target: participantSettings.ownerId, set: { repositoryUrl: sql`coalesce(${participantSettings.repositoryUrl}, ${mutation.repositoryUrl ?? null})`, updatedAt } });
      if (mutation.completedSteps.length) {
        await db.batch([
          db.insert(workshopCompletedSteps).values(mutation.completedSteps.map((stepId) => ({ ownerId, stepId, updatedAt }))).onConflictDoNothing(),
          importSettings,
        ]);
      } else await importSettings;
    }
    console.info("progress.saved", { action: mutation.action });
    return Response.json(await progressFor(user), { headers: responseHeaders });
  } catch (error) { return errorResponse(error, "save"); }
}
