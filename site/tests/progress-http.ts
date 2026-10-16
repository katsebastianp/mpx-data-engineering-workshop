/** Local integration check against an already running, migrated preview.
 * Run: node --experimental-strip-types tests/progress-http.ts http://127.0.0.1:5177
 * Uses the preview's real local sign-in cookie. Snapshots and restores only
 * local_seedy's progress, and removes only this run's synthetic second owner.
 * Keep this local preview idle while the fixture runs. Never launches a server,
 * applies a migration, or writes to a remote site.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import type { AuthenticatedProgress } from "../lib/progress";

const { participantBranchCandidates } = await import(new URL("../lib/progress.ts", import.meta.url).href) as typeof import("../lib/progress");
const { workspaceForParticipant } = await import(new URL("../lib/participant.ts", import.meta.url).href) as typeof import("../lib/participant");
type Row = Record<string, string | number | null>;
type Progress = AuthenticatedProgress;

const base = new URL(process.argv[2] ?? "http://127.0.0.1:5177");
if (base.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) || base.username || base.password) {
  throw new Error("Progress integration checks require an HTTP loopback preview; remote and production writes are forbidden.");
}
const endpoint = new URL("/api/progress", base);
const ownerA = "local_seedy";
const ownerB = `progress-integration-${randomUUID()}`;
const run = promisify(execFile);
const cwd = fileURLToPath(new URL("../", import.meta.url));
const passed: string[] = [];
let cookie = "";
let fixtureStarted = false;
const tables = ["workshop_completed_steps", "workshop_participant_settings", "workshop_runs", "workshop_run_steps"] as const;
const snapshots = new Map<string, Row[]>();

const literal = (value: string | number | null): string => value === null ? "NULL"
  : typeof value === "number" ? String(value) : `'${value.replaceAll("'", "''")}'`;
const identifier = (value: string): string => {
  assert.match(value, /^[a-z_]+$/, "SQL identifiers must come from the known local schema");
  return `"${value}"`;
};

async function dbQuery(sql: string): Promise<Row[]> {
  const result = await run(process.execPath, [
    "--import", "./scripts/sites-env.mjs", "node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local",
    "--persist-to", ".wrangler/state", "--config", "dist/server/wrangler.json",
    "--command", sql, "--json",
  ], { cwd, maxBuffer: 2_000_000 });
  const results = JSON.parse(result.stdout) as { success?: boolean; results: Row[] }[];
  assert.ok(results.every((result) => result.success !== false), "local D1 query must succeed");
  return results.flatMap((result) => result.results);
}

function headers(signedIn = true): Record<string, string> {
  return {
    "Content-Type": "application/json", Origin: base.origin,
    ...(signedIn ? { Cookie: cookie, "X-Workshop-Account": ownerA } : {}),
  };
}

async function patch(body: unknown, expectedStatus = 200, extraHeaders: Record<string, string> = {}, signedIn = true) {
  const response = await fetch(endpoint, {
    method: "PATCH", headers: { ...headers(signedIn), ...extraHeaders }, body: JSON.stringify(body),
    redirect: "error",
  });
  assert.equal(response.status, expectedStatus, `PATCH status: ${await response.clone().text()}`);
  return response;
}

async function readProgress(): Promise<Progress> {
  // A fresh HTTP request has no browser state or retained client-side progress.
  const response = await fetch(endpoint, { headers: { Cookie: cookie }, redirect: "error" });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  const progress = await response.json() as Progress;
  assert.equal(progress.authenticated, true);
  assert.equal(progress.account.subject, ownerA);
  assert.equal(typeof progress.account.displayName, "string");
  assert.equal(typeof progress.account.email, "string");
  assert.match(progress.signOutUrl, /^\/signout-with-chatgpt\?/);
  return progress;
}

function sortedRows(rows: Row[]) {
  return rows.map((row) => JSON.stringify(Object.fromEntries(Object.entries(row).sort(([left], [right]) => left.localeCompare(right))))).sort();
}

async function rowsFor(table: string, owner: string) {
  return dbQuery(`SELECT * FROM ${identifier(table)} WHERE owner_id = ${literal(owner)}`);
}

async function readAnonymous() {
  const response = await fetch(endpoint, { redirect: "error" });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  const body = await response.json() as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), ["authenticated", "signInUrl"]);
  assert.equal(body.authenticated, false);
  assert.match(String(body.signInUrl), /^\/signin-with-chatgpt\?/);
  return body;
}

try {
  await readAnonymous();
  passed.push("anonymous reads expose no account, progress, or repository");

  const completeProject = { action: "complete", stepId: "project", completed: true };
  const anonymousWrite = await patch(completeProject, 401, {}, false);
  assert.match(String((await anonymousWrite.json() as { signInUrl: string }).signInUrl), /^\/signin-with-chatgpt\?/);
  await patch(completeProject, 401, {
    "oai-authenticated-user-id": ownerA,
    "oai-authenticated-user-email": "forged@example.invalid",
    "X-Workshop-Account": ownerA,
  }, false);
  passed.push("anonymous writes and caller-supplied identity headers are rejected");

  const signIn = await fetch(new URL("/signin-with-chatgpt?return_to=/workshop", base), { redirect: "manual" });
  assert.equal(signIn.status, 302);
  cookie = signIn.headers.get("set-cookie")?.split(";")[0] ?? "";
  assert.ok(cookie, "local sign-in must provide its trusted authentication cookie");
  // Preserve any participant progress already in the developer's local preview.
  // Do not use a remote D1 command or touch any leaderboard rows.
  const backups = [];
  for (const table of tables) backups.push({ table, ownRows: await rowsFor(table, ownerA), otherRows: await rowsFor(table, ownerB) });
  for (const { table, ownRows, otherRows } of backups) {
    snapshots.set(table, ownRows);
    assert.equal(otherRows.length, 0, "the randomly generated fixture owner must not already exist");
  }
  fixtureStarted = true;
  const initial = await readProgress();
  passed.push("the real preview sign-in authenticates a private progress read");
  for (const table of tables) await dbQuery(`DELETE FROM ${identifier(table)} WHERE owner_id = ${literal(ownerA)}`);

  // The local authentication simulator offers one trusted identity. Seed only
  // another owner's local DB rows. Claiming the same profile-name preference
  // exercises the real unique constraint without spoofing authentication.
  const fixtureDate = "2026-01-01T00:00:00.000Z";
  const otherRepository = "https://github.com/other-participant/private-workshop";
  const branchCandidates = participantBranchCandidates(initial.account.displayName, initial.workspace.id);
  await dbQuery(`INSERT INTO workshop_completed_steps (owner_id, step_id, updated_at) VALUES (${literal(ownerB)}, 'upload', ${literal(fixtureDate)})`);
  await dbQuery(`INSERT INTO workshop_participant_settings (owner_id, repository_url, branch_name, updated_at) VALUES (${literal(ownerB)}, ${literal(otherRepository)}, ${literal(branchCandidates[0])}, ${literal(fixtureDate)})`);
  const firstReads = await Promise.all([readProgress(), readProgress(), readProgress(), readProgress()]);
  const empty = firstReads[0];
  assert.deepEqual(empty.completedSteps, []);
  assert.equal(empty.repositoryUrl, null);
  assert.equal(empty.workspace.branch, branchCandidates[1], "a taken first name gets its deterministic collision suffix");
  assert.deepEqual(empty.workspace, workspaceForParticipant(initial.workspace.id, branchCandidates[1]));
  for (const result of firstReads) assert.deepEqual(result.workspace, empty.workspace, "concurrent first reads must resolve the same persisted branch");
  const allocatedRows = await rowsFor(tables[1], ownerA);
  assert.equal(allocatedRows.length, 1);
  assert.equal(allocatedRows[0].branch_name, branchCandidates[1]);
  passed.push("same-name collision and concurrent first requests allocate one durable personal branch");

  // A previously allocated name is authoritative even when the current profile
  // prefers another name. This simulates a profile change in the one-user dev shim.
  const historicalBranch = `previous-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  await dbQuery(`UPDATE workshop_participant_settings SET branch_name = ${literal(historicalBranch)} WHERE owner_id = ${literal(ownerA)}`);
  const returning = await readProgress();
  assert.equal(returning.workspace.branch, historicalBranch);
  assert.equal(returning.workspace.integrationBranch, historicalBranch);
  assert.equal(returning.workspace.pipelineBranch, `${historicalBranch}-pipeline_optimization`);
  assert.equal(returning.workspace.modelsBranch, `${historicalBranch}-predictive_models`);
  passed.push("an existing branch survives a different current profile preference and both worktrees merge into it");

  const isolated = await readProgress();
  assert.deepEqual(isolated.completedSteps, []);
  assert.equal(isolated.repositoryUrl, null);
  assert.ok(!JSON.stringify(isolated).includes(ownerB));
  assert.ok(!JSON.stringify(isolated).includes(otherRepository));
  passed.push("another owner's seeded progress and repository stay private");

  await patch(completeProject);
  const completed = await readProgress();
  assert.deepEqual(completed.completedSteps, ["project"]);
  assert.ok(completed.updatedAt && Number.isFinite(Date.parse(completed.updatedAt)));
  assert.equal((await rowsFor(tables[0], ownerA)).filter((row) => row.step_id === "project").length, 1);
  await patch(completeProject);
  assert.equal((await rowsFor(tables[0], ownerA)).filter((row) => row.step_id === "project").length, 1, "repeated completion must be idempotent");
  passed.push("completion survives a fresh authenticated request and is durable and idempotent");

  await patch({ action: "complete", stepId: "smoke", completed: true });
  await patch({ action: "complete", stepId: "project", completed: false });
  assert.deepEqual((await readProgress()).completedSteps, ["smoke"]);
  passed.push("undo removes only the selected step");

  const repository = "https://github.com/ringier/workshop-test";
  await patch({ action: "repository", repositoryUrl: repository });
  assert.equal((await readProgress()).repositoryUrl, repository, "a new client with the same session reads the saved repository");
  await patch({ action: "repository", repositoryUrl: "https://token:secret@github.com/ringier/workshop" }, 400);
  await patch({ action: "repository", repositoryUrl: "javascript:alert(1)" }, 400);
  assert.equal((await readProgress()).repositoryUrl, repository, "invalid links must not replace the saved repository");
  passed.push("repository links persist across requests and reject unsafe URLs");

  await patch({ action: "complete", stepId: "unknown-step", completed: true }, 400);
  await patch({ ...completeProject, ownerId: ownerB }, 400);
  await patch({ ...completeProject, owner_id: ownerB }, 400);
  await patch({ action: "repository", repositoryUrl: repository, branchName: "main" }, 400);
  await patch({ action: "import", completedSteps: ["upload"], account: { subject: ownerB } }, 400);
  passed.push("unknown steps and injected owner/account fields are rejected");

  await patch(completeProject, 409, { "X-Workshop-Account": ownerB });
  await patch(completeProject, 409, { "X-Workshop-Account": "" });
  await patch(completeProject, 403, { Origin: "https://unrelated.invalid" });
  await patch(completeProject, 403, { "Sec-Fetch-Site": "cross-site" });
  assert.deepEqual((await readProgress()).completedSteps, ["smoke"], "rejected writes must not change progress");
  passed.push("stale or missing account context and cross-origin writes cannot mutate progress");

  await patch({ action: "import", completedSteps: ["project", "worktrees", "project"], repositoryUrl: "https://github.com/ringier/old-browser-link" });
  const imported = await readProgress();
  assert.deepEqual(imported.completedSteps, ["project", "smoke", "worktrees"]);
  assert.equal(imported.repositoryUrl, repository, "explicit import must not overwrite an established server repository");
  await patch({ action: "import", completedSteps: ["project", "worktrees"] });
  assert.deepEqual((await readProgress()).completedSteps, imported.completedSteps, "repeated import must be idempotent");
  passed.push("explicit import unions completed steps without replacing the saved repository");

  const concurrentWrites = await Promise.allSettled([
    patch({ action: "complete", stepId: "profile", completed: true }),
    patch({ action: "complete", stepId: "experiments", completed: true }),
  ]);
  for (const result of concurrentWrites) if (result.status === "rejected") throw result.reason;
  const concurrent = await readProgress();
  assert.deepEqual(new Set(concurrent.completedSteps), new Set(["project", "smoke", "worktrees", "profile", "experiments"]));
  assert.equal(concurrent.repositoryUrl, repository);
  assert.equal((await rowsFor(tables[0], ownerA)).length, 5);
  passed.push("simultaneous mutations of different steps both persist");

  assert.deepEqual(await rowsFor(tables[0], ownerB), [{ owner_id: ownerB, step_id: "upload", updated_at: fixtureDate }]);
  assert.deepEqual(await rowsFor(tables[1], ownerB), [{ owner_id: ownerB, repository_url: otherRepository, branch_name: branchCandidates[0], active_run_name: null, updated_at: fixtureDate }]);
  assert.equal((await readProgress()).workspace.branch, historicalBranch, "progress and repository writes must never reset the allocated branch");
  const run1 = `run-${randomUUID().replaceAll("-", "").slice(0, 12)}-one`;
  const run2 = run1.replace(/-one$/, "-two");
  await patch({ action: "run", name: "main" }, 400);
  await patch({ action: "run", name: "x; echo unsafe" }, 400);
  await patch({ action: "run", name: branchCandidates[0] }, 409);
  await patch({ action: "run", name: historicalBranch }, 409);
  await dbQuery(`INSERT INTO workshop_runs (name, owner_id, updated_at) VALUES ('reserved-other-run', ${literal(ownerB)}, ${literal(fixtureDate)})`);
  await patch({ action: "run", name: "reserved-other-run" }, 409);
  await patch({ action: "run", name: run1 });
  const firstRun = await readProgress();
  assert.equal(firstRun.workspace.branch, run1);
  assert.equal(firstRun.workspace.composePrefix, `ws-${run1}`);
  assert.equal(firstRun.workspace.id, initial.workspace.id);
  assert.deepEqual(firstRun.completedSteps, []);
  assert.equal(firstRun.repositoryUrl, null);
  await patch(completeProject, 409); // Original tab cannot modify the new run.
  await patch(completeProject, 200, { "X-Workshop-Run": run1 });
  await patch({ action: "repository", repositoryUrl: repository }, 200, { "X-Workshop-Run": run1 });
  await patch({ action: "run", name: run2 }, 200, { "X-Workshop-Run": run1 });
  assert.deepEqual((await readProgress()).completedSteps, []);
  assert.equal((await readProgress()).repositoryUrl, null);
  await patch(completeProject, 409, { "X-Workshop-Run": run1 });
  await patch({ action: "run", name: run1 }, 200, { "X-Workshop-Run": run2 });
  const resumedRun = await readProgress();
  assert.deepEqual(resumedRun.completedSteps, ["project"]);
  assert.equal(resumedRun.repositoryUrl, repository);
  assert.deepEqual(resumedRun.availableRuns, [run1, run2].sort());
  await patch({ action: "run", name: null }, 200, { "X-Workshop-Run": run1 });
  assert.deepEqual((await readProgress()).completedSteps, concurrent.completedSteps);
  assert.equal((await readProgress()).workspace.branch, historicalBranch);
  passed.push("two named runs isolate and resume branches, Docker, checklist and repository; legacy progress survives; collisions, unsafe names and stale tabs are rejected");
  await readAnonymous();
  passed.push("all mutations leave the other owner unchanged and anonymous reads remain private");
} finally {
  if (fixtureStarted) {
    for (const table of tables) {
      // Both predicates are explicit owners: never truncate or clear a table.
      await dbQuery(`DELETE FROM ${identifier(table)} WHERE owner_id IN (${literal(ownerA)}, ${literal(ownerB)})`);
      for (const row of snapshots.get(table) ?? []) {
        await dbQuery(`INSERT INTO ${identifier(table)} (${Object.keys(row).map(identifier).join(", ")}) VALUES (${Object.values(row).map(literal).join(", ")})`);
      }
      assert.deepEqual(sortedRows(await rowsFor(table, ownerA)), sortedRows(snapshots.get(table) ?? []), "the developer's original local progress must be restored exactly");
      assert.equal((await rowsFor(table, ownerB)).length, 0, "the synthetic second owner must be removed");
    }
    passed.push("original local progress restored and only this run's synthetic records removed");
  }
}
console.log(`PASS: ${passed.length} progress integration checks\n${passed.map((check) => `- ${check}`).join("\n")}`);
