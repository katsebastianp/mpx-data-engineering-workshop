import { desc, eq } from "drizzle-orm";
import { getChatGPTUser, chatGPTSignInPath } from "../../chatgpt-auth";
import { getDb } from "../../../db";
import { submissions } from "../../../db/schema";
import {
  assertSubmissionWriteContext, bindParticipantSubmission, buildAwards, leaderboardParticipant,
  loadEvaluation, MAX_SUBMISSION_BYTES, readSubmission, SubmissionError, validateSubmission,
  type Evaluation, type LeaderboardResponse,
} from "../../../lib/competition";
import { participantWorkspaceFor } from "../../../lib/participant";
// This import belongs exclusively to the server route. Never import this file
// or the evaluation JSON from a component, page, or other client entry point.
import evaluation from "../../../lib/server/evaluation.json";

export const dynamic = "force-dynamic";
const truthPromise = loadEvaluation(evaluation as Evaluation);
const responseHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

function errorResponse(error: unknown, operation: string) {
  if (error instanceof SubmissionError) {
    console.warn(`leaderboard.${operation}_rejected`, { status: error.status });
    return Response.json({ error: error.message }, { status: error.status, headers: responseHeaders });
  }
  // Do not echo database errors: they can include query parameters and owner IDs.
  console.error(`leaderboard.${operation}_failed`, { kind: error instanceof Error ? error.name : "unknown" });
  return Response.json({ error: "The leaderboard is temporarily unavailable. Please try again shortly." }, { status: 503, headers: responseHeaders });
}

export async function GET() {
  try {
    const [user, truth] = await Promise.all([getChatGPTUser(), truthPromise]);
    const participant = user ? leaderboardParticipant((await participantWorkspaceFor(user.userId)).id, user.fullName) : null;
    const rows = await getDb().select().from(submissions).orderBy(desc(submissions.updatedAt));
    const entries = await Promise.all(rows.map(async (row) => {
      const { id } = await participantWorkspaceFor(row.ownerId);
      // Existing aliases are never treated as people. Preserve their result,
      // use a stable ID, and refresh the profile label on the owner's next upload.
      const label = row.ownerId === user?.userId && participant ? participant
        : leaderboardParticipant(id, "participant" in row.entry ? row.entry.participant.displayName : null);
      return bindParticipantSubmission(row.entry, label);
    }));
    const ownIndex = user ? rows.findIndex((row) => row.ownerId === user.userId) : -1;
    const payload: LeaderboardResponse = {
      entries, awards: buildAwards(entries), dataset_id: truth.dataset_id,
      authenticated: Boolean(user), participant, own_entry: ownIndex < 0 ? null : entries[ownIndex],
      max_upload_bytes: MAX_SUBMISSION_BYTES,
    };
    return Response.json(payload, { headers: responseHeaders });
  } catch (error) { return errorResponse(error, "read"); }
}

export async function POST(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return Response.json({ error: "Sign in with ChatGPT to upload your result.", sign_in_url: chatGPTSignInPath("/leaderboard") }, { status: 401, headers: responseHeaders });
    assertSubmissionWriteContext(request, user.userId);
    const payload = await readSubmission(request);
    const result = validateSubmission(payload, await truthPromise);
    const workspace = await participantWorkspaceFor(user.userId);
    const participant = leaderboardParticipant(workspace.id, user.fullName);
    const entry = bindParticipantSubmission(result, participant);
    const db = getDb();
    const ownedRows = await db.select({ teamKey: submissions.teamKey }).from(submissions)
      .where(eq(submissions.ownerId, user.userId)).limit(1);
    // The old team_key column is now only an opaque storage key. Retain existing
    // keys and rows; a supplied alias never participates in lookup or writes.
    const saved = await db.insert(submissions).values({ teamKey: ownedRows[0]?.teamKey ?? crypto.randomUUID(), ownerId: user.userId, entry, updatedAt: entry.updated_at })
      .onConflictDoUpdate({ target: submissions.ownerId, set: { entry, updatedAt: entry.updated_at } })
      .returning({ teamKey: submissions.teamKey });
    if (!saved.length) throw new SubmissionError("Your result could not be saved. Please try again.", 409);
    console.info("leaderboard.submission_saved", { model: entry.model, final: entry.test_selection === "final", metrics_match: entry.reported_metrics_match });
    return Response.json({ entry, participant, message: entry.reported_metrics_match ? "Submission verified and saved." : "Submission saved. Displayed quality uses server-recomputed metrics; the uploaded metrics differed." }, { status: ownedRows.length ? 200 : 201, headers: responseHeaders });
  } catch (error) { return errorResponse(error, "upload"); }
}
