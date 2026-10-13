/** Local integration check against an already running, migrated preview.
 * Run: node --experimental-strip-types tests/leaderboard-http.ts http://127.0.0.1:3000 [existing-submission.json]
 * Synthetic records are removed from local D1 in finally; never targets a remote site.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import type { Evaluation, LeaderboardEntry, LeaderboardResponse, Split } from "../lib/competition";

const { loadEvaluation, REFERENCE_KERNEL, validateSubmission, teamIdentity, parseSubmissionJson } = await import(new URL("../lib/competition.ts", import.meta.url).href) as typeof import("../lib/competition");
const { participantWorkspaceFor } = await import(new URL("../lib/participant.ts", import.meta.url).href) as typeof import("../lib/participant");
const base = new URL(process.argv[2] ?? "http://127.0.0.1:3000");
if (base.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)) {
  throw new Error("Integration tests require an HTTP loopback preview; remote and production writes are forbidden.");
}
const origin = base.origin;
const endpoint = new URL("/api/leaderboard", base);
const evaluation = JSON.parse(await readFile(new URL("../lib/server/evaluation.json", import.meta.url), "utf8")) as Evaluation;
const truth = await loadEvaluation(evaluation);
const nonce = randomUUID();
const ownerA = "local_seedy";
const ownerB = `integration-b-${nonce}`;
const workspaceA = await participantWorkspaceFor(ownerA);
const workspaceB = await participantWorkspaceFor(ownerB);
const team = `Integration ${nonce}`;
const run = promisify(execFile);
const cwd = new URL("../", import.meta.url).pathname;
let wrote = false;
let cookie = "";

function headers(signedIn = false): Record<string, string> {
  return { "Content-Type": "application/json", Origin: origin,
    ...(signedIn ? { Cookie: cookie, "X-Workshop-Account": ownerA } : {}) };
}
async function post(body: unknown, signedIn = false, extraHeaders: Record<string, string> = {}) {
  return fetch(endpoint, { method: "POST", headers: { ...headers(signedIn), ...extraHeaders }, body: JSON.stringify(body) });
}
async function dbQuery(sql: string) {
  const result = await run(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local", "--persist-to", ".wrangler/state", "--config", "dist/server/wrangler.json", "--command", sql, "--json"], { cwd, maxBuffer: 2_000_000 });
  return JSON.parse(result.stdout) as { results: Record<string, unknown>[] }[];
}
const payload = {
  version: 1, dataset_id: evaluation.dataset_id, experiment_id: "integration-check", run_id: `integration-${nonce}`,
  team, model: "logistic", feature_names: ["jet_pt"], feature_set: "basic", parameters: { C: 1, max_iter: 100 },
  seed: 42, feature_source_sha256: "a".repeat(64), decision_threshold: 0.5,
  evaluated_splits: ["validation", "test"], test_selection: "final", metrics: {},
  timings: { training_seconds: 0.2, inference_seconds: 0.02, reference_seconds: 0.2, benchmark_rows: 128, repeat_count: 3 },
  hardware: { cpu_description: "Synthetic integration test" },
  explanation: "Temporary synthetic integration test. Removed automatically after verification.",
  timestamp: new Date().toISOString(),
  latency_protocol: { id: "jetclass2-cpu-128-v1", warmups: 1, repeats: 3, threads: 1, reference_iterations: 64, benchmark_rows: 128, reference_kernel: REFERENCE_KERNEL, includes_feature_matrix_or_tensor_conversion: true, includes_model_loading: false, batch_strategy: "one batch of 128 jets", validation_ids_sha256: truth.validation_ids_sha256 },
  predictions: (["validation", "test"] as Split[]).flatMap((split) => evaluation.splits[split].map((row) => ({ split, record_id: row.record_id, signal_score: row.label ? 0.8 : 0.2 }))),
};
if (process.argv[3]) Object.assign(payload, parseSubmissionJson(await readFile(process.argv[3], "utf8")), { team, run_id: `integration-${nonce}` });
const expectedEntry = validateSubmission(payload, truth);

try {
  const unauthenticated = await post(payload);
  assert.equal(unauthenticated.status, 401, "anonymous upload must require ChatGPT authentication");
  const anonymousJson = await unauthenticated.json() as { sign_in_url: string };
  assert.match(anonymousJson.sign_in_url, /^\/signin-with-chatgpt\?/);

  const spoofed = await post(payload, false, { "oai-authenticated-user-id": ownerA, "oai-authenticated-user-email": "local@example.invalid" });
  assert.equal(spoofed.status, 401, "local auth middleware must strip caller-supplied identity headers");
  const signIn = await fetch(new URL("/signin-with-chatgpt?return_to=/leaderboard", base), { redirect: "manual" });
  assert.equal(signIn.status, 302);
  cookie = signIn.headers.get("set-cookie")?.split(";")[0] ?? "";
  assert.ok(cookie, "local sign-in must provide its auth cookie");
  const before = await (await fetch(endpoint, { headers: headers(true) })).json() as LeaderboardResponse;
  assert.equal(before.own_entry, null, "local preview already has a local_seedy result; preserve it and use a fresh test database");
  assert.equal(before.participant?.id, workspaceA.id, "signed-in metadata exists before first upload");

  const crossSite = await post(payload, true, { Origin: "https://unrelated.invalid" });
  assert.equal(crossSite.status, 403, "cross-origin authenticated write must be rejected");

  const staleAccount = await post(payload, true, { "X-Workshop-Account": ownerB });
  assert.equal(staleAccount.status, 409, "an account switch after file selection must reject the upload");
  const missingAccount = await post(payload, true, { "X-Workshop-Account": "" });
  assert.equal(missingAccount.status, 409, "an upload must bind to the displayed account");

  // The trusted dev simulator has one identity. Seed a different owner's row
  // directly into local D1 to exercise the HTTP conflict check without bypassing auth.
  const otherTeam = `${team}-other`;
  const otherEntry = { ...validateSubmission({ ...payload, team: otherTeam }, truth), team: otherTeam };
  const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
  await dbQuery(`INSERT INTO leaderboard_submissions (team_key, owner_id, entry, updated_at) VALUES (${literal(teamIdentity(otherTeam).key)}, ${literal(ownerB)}, ${literal(JSON.stringify(otherEntry))}, ${literal(otherEntry.updated_at)})`);
  wrote = true;
  const legacyBoard = await (await fetch(endpoint)).json() as LeaderboardResponse;
  assert.equal(legacyBoard.entries.find(entry => entry.participant.id === workspaceB.id)?.participant.displayName, workspaceB.id, "legacy results are retained under their authenticated owner's participant ID");
  const created = await post({ ...payload, team: otherTeam }, true);
  assert.equal(created.status, 201, `first authenticated upload must be saved: ${await created.clone().text()}`);
  wrote = true;
  const saved = await created.json() as { entry: LeaderboardEntry };
  assert.equal(saved.entry.participant.id, workspaceA.id, "a submitted alias cannot impersonate another account");
  assert.ok(!Object.hasOwn(saved.entry, "team"), "legacy aliases must not appear as public identity");
  const otherAfter = await dbQuery(`SELECT entry FROM leaderboard_submissions WHERE owner_id = ${literal(ownerB)}`);
  assert.equal(otherAfter[0].results[0].entry, JSON.stringify(otherEntry), "another owner's original result must remain unchanged");
  assert.equal(saved.entry.metrics.test!.roc_auc, expectedEntry.metrics.test!.roc_auc, "quality must be recomputed from scores");
  assert.equal(saved.entry.reported_metrics_match, expectedEntry.reported_metrics_match, "reported metrics must be checked against independent recomputation");

  const publicResponse = await fetch(endpoint);
  assert.equal(publicResponse.status, 200);
  const publicText = await publicResponse.text();
  const publicBoard = JSON.parse(publicText) as LeaderboardResponse;
  assert.equal(publicBoard.authenticated, false);
  assert.equal(publicBoard.own_entry, null);
  assert.equal(publicBoard.participant, null);
  assert.equal(publicBoard.entries.find((entry) => entry.participant.id === workspaceA.id)?.metrics.test?.roc_auc, expectedEntry.metrics.test!.roc_auc);
  for (const privateValue of [ownerA, ownerB, "example.invalid", '"predictions"', '"ownerId"', '"owner_id"']) assert.ok(!publicText.includes(privateValue), `public response leaked ${privateValue}`);

  const privateBoard = await (await fetch(endpoint, { headers: headers(true) })).json() as LeaderboardResponse;
  assert.equal(privateBoard.authenticated, true); assert.equal(privateBoard.own_entry?.participant.id, workspaceA.id);

  const secondAlias = await post({ ...payload, team: `${team}-2` }, true);
  assert.equal(secondAlias.status, 200, "changing the legacy file alias still updates the same account-owned result");
  const secondAliasJson = await secondAlias.json() as {entry: LeaderboardEntry};
  assert.equal(secondAliasJson.entry.participant.id, workspaceA.id);
  const invalid = await post({ ...payload, predictions: payload.predictions.slice(1) }, true);
  assert.equal(invalid.status, 400, "incomplete split coverage must be rejected");

  // Simulate an existing participant's pre-upgrade row. Its historical storage
  // key must survive an owner update; no migration may drop or recreate it.
  const legacyKey = `legacy-${nonce}`;
  const legacyOwnEntry = { ...validateSubmission(payload, truth), team };
  await dbQuery(`UPDATE leaderboard_submissions SET team_key = ${literal(legacyKey)}, entry = ${literal(JSON.stringify(legacyOwnEntry))} WHERE owner_id = ${literal(ownerA)}`);

  const updatedExplanation = "Updated by the same authenticated owner.";
  const replaced = await post({ ...payload, explanation: updatedExplanation }, true);
  assert.equal(replaced.status, 200, "same owner can replace its result");
  const persisted = await dbQuery(`SELECT team_key, owner_id, entry FROM leaderboard_submissions WHERE owner_id = '${ownerA}'`);
  assert.equal(persisted[0].results.length, 1, "exactly one durable D1 row should exist");
  assert.equal(persisted[0].results[0].team_key, legacyKey, "an existing storage key must not be renamed or deleted");
  const storedEntry = JSON.parse(String(persisted[0].results[0].entry));
  assert.equal(storedEntry.explanation, updatedExplanation, "D1 must contain the replacement");
  assert.equal(storedEntry.participant.id, workspaceA.id);
  assert.ok(!Object.hasOwn(storedEntry, "team"), "legacy aliases are discarded from saved results");
  assert.ok(!Object.hasOwn(storedEntry, "predictions"), "raw submitted predictions must not be persisted");
  console.log(`PASS: HTTP authentication, origin checks, verified quality (test AUC ${saved.entry.metrics.test!.roc_auc}), durable D1 storage, ownership, replacement, privacy and invalid input rejection.`);
} finally {
  if (wrote) {
    const condition = `owner_id = '${ownerB}' OR (owner_id = '${ownerA}' AND json_extract(entry, '$.run_id') = '${payload.run_id}')`;
    await dbQuery(`DELETE FROM leaderboard_submissions WHERE ${condition}`);
    const remaining = await dbQuery(`SELECT COUNT(*) AS count FROM leaderboard_submissions WHERE ${condition}`);
    assert.equal(remaining[0].results[0].count, 0, "synthetic test records must be removed");
    console.log("PASS: temporary integration records removed from local D1.");
  }
}
