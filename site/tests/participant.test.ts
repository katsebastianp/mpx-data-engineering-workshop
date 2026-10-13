import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const { participantWorkspaceFor, personaliseWorkshopText, workspaceForParticipant } =
  await import(new URL("../lib/participant.ts", import.meta.url).href) as typeof import("../lib/participant");
const { participantBranchCandidates } =
  await import(new URL("../lib/progress.ts", import.meta.url).href) as typeof import("../lib/progress");
const { workshopExercises } =
  await import(new URL("../components/workshop-content.ts", import.meta.url).href) as typeof import("../components/workshop-content");

const idA = "p-0123456789abcdef";
const idB = "p-fedcba9876543210";
const leon = workspaceForParticipant(idA, "leon");
const secondLeon = workspaceForParticipant(idB, "leon-fedcba98");
const repository = "https://github.com/example/particle-workshop";
const byId = new Map(workshopExercises.map((step) => [step.id, step]));

test("one personal branch is both starting point and final merge destination", () => {
  assert.equal(leon.branch, "leon");
  assert.equal(leon.pipelineBranch, "leon-pipeline_optimization");
  assert.equal(leon.modelsBranch, "leon-predictive_models");
  assert.equal(leon.integrationBranch, leon.branch);
  const refs = [leon.branch, leon.pipelineBranch, leon.modelsBranch];
  assert.equal(new Set(refs).size, 3);
  for (const ref of refs) {
    const check = spawnSync("git", ["check-ref-format", "--branch", ref], { encoding: "utf8" });
    assert.equal(check.status, 0, `${ref}: ${check.stderr}`);
    assert.ok(!refs.some((other) => other !== ref && other.startsWith(`${ref}/`)), "No Git file/directory ref collision");
  }
});

test("participant identity is stable across display-name changes and separate across accounts", async () => {
  const first = await participantWorkspaceFor("account-A", "leon");
  const renamed = await participantWorkspaceFor("account-A", "leo");
  const other = await participantWorkspaceFor("account-B", "leon-2");
  assert.match(first.id, /^p-[a-f0-9]{16}$/);
  assert.equal(first.id, renamed.id);
  assert.equal(first.composePrefix, renamed.composePrefix);
  assert.notEqual(first.id, other.id);
  assert.notEqual(first.composePrefix, other.composePrefix);
  assert.ok(!JSON.stringify(first).includes("account-A"));
  await assert.rejects(participantWorkspaceFor(""));
});

test("unsafe or shared branch names cannot become executable workshop names", () => {
  for (const branch of ["main", "master", "head", "HEAD", "leon/main", "leon..other", "123", "-leon", "leon-", "leon;echo", "$(echo)", "leon name", "a".repeat(49)]) {
    assert.throws(() => workspaceForParticipant(idA, branch), branch);
  }
  for (const id of ["leon", "p-123", "p-0123456789ABCDEF", `${idA};echo`]) {
    assert.throws(() => workspaceForParticipant(id, "leon"));
  }
});

test("first-name preferences and every collision fallback are valid branch names", () => {
  assert.equal(participantBranchCandidates("Léon Jouet", idA)[0], "leon");
  for (const name of [null, "", "  ", "Léon Jouet", "Anne-Marie Smith", "李 雷", "123 Alex", "1alex", "main User", "head User", "person@example.com", "$(touch ignored)", "A".repeat(100)]) {
    const candidates = participantBranchCandidates(name, idA);
    assert.ok(candidates.length > 0);
    assert.equal(new Set(candidates).size, candidates.length);
    for (const candidate of candidates) assert.doesNotThrow(() => workspaceForParticipant(idA, candidate), `${String(name)} → ${candidate}`);
  }
  const first = participantBranchCandidates("Léon Jouet", idA);
  const sameName = participantBranchCandidates("Léon Other", idB);
  assert.equal(first[0], sameName[0]);
  assert.notEqual(first[1], sameName[1], "Same-name accounts have independent collision candidates");
  assert.notEqual(first.at(-1), sameName.at(-1));
  for (const name of [null, "person@example.com", "main"]) {
    assert.match(participantBranchCandidates(name, idA)[0], /^participant-/);
  }
});

test("personalisation derives controlled names instead of trusting forged derived fields", () => {
  const forged = { ...leon, pipelineBranch: "main; echo unsafe", modelsBranch: "other-person", integrationBranch: "main", composePrefix: "other-person" };
  const result = personaliseWorkshopText("{{branch}} {{pipelineBranch}} {{modelsBranch}} {{integrationBranch}} {{composePrefix}} {{participantId}}", forged, repository);
  assert.equal(result, `${leon.branch} ${leon.pipelineBranch} ${leon.modelsBranch} ${leon.branch} ${leon.composePrefix} ${idA}`);
  assert.throws(() => personaliseWorkshopText("{{unknownPlaceholder}}", leon, repository));
  assert.equal(personaliseWorkshopText("{{repositoryUrl}}", leon, repository), repository);
  assert.match(personaliseWorkshopText("{{repositoryUrl}}", leon, null), /facilitator/);
});

test("every workflow template renders completely for different authenticated participants", () => {
  for (const workspace of [leon, secondLeon]) {
    for (const step of workshopExercises) {
      for (const extra of step.extraPrompts ?? []) {
        assert.doesNotMatch(personaliseWorkshopText(extra.prompt, workspace, repository), /\{\{[^}]+\}\}/);
      }
      for (const field of ["instruction", "hint", "prompt", "checkpoint", "commands"] as const) {
        const template = step[field];
        if (!template) continue;
        const rendered = personaliseWorkshopText(template, workspace, repository);
        assert.doesNotMatch(rendered, /\{\{[^}]+\}\}/, `${step.id}.${field}`);
        assert.doesNotMatch(rendered, /workshop\/(?:start|pipeline|models|integration)/, `${step.id}.${field} retains a shared branch`);
        assert.ok(!rendered.includes(workspace.id === idA ? idB : idA), `${step.id}.${field} includes another participant`);
      }
    }
  }
});

test("workshop dependencies are complete and acyclic", () => {
  assert.equal(byId.size, workshopExercises.length, "Exercise IDs are unique");
  const complete = new Set<string>();
  const visit = (id: string, path: Set<string>) => {
    assert.ok(!path.has(id), `Dependency cycle at ${id}`);
    if (complete.has(id)) return;
    const step = byId.get(id);
    assert.ok(step, `Unknown dependency ${id}`);
    for (const dependency of step.dependsOn) visit(dependency, new Set([...path, id]));
    complete.add(id);
  };
  for (const step of workshopExercises) visit(step.id, new Set());
});

function ancestors(id: string, visited = new Set<string>()): Set<string> {
  const step = byId.get(id);
  assert.ok(step, `Missing exercise ${id}`);
  for (const dependency of step.dependsOn) {
    if (!visited.has(dependency)) { visited.add(dependency); ancestors(dependency, visited); }
  }
  return visited;
}

test("code orientation precedes baseline and both parallel paths begin after the same setup", () => {
  assert.ok(ancestors("overview").has("project"));
  assert.ok(ancestors("smoke").has("overview"));
  assert.ok(ancestors("profile").has("worktrees"));
  assert.ok(ancestors("experiments").has("worktrees"));
  assert.ok(!ancestors("profile").has("experiments"));
  assert.ok(!ancestors("experiments").has("profile"));
  assert.ok(!ancestors("select").has("pr-review"));
  assert.ok(!ancestors("pr-review").has("select"));
});

test("both completed paths must rejoin before validation, final test, and upload", () => {
  for (const id of ["integrate", "preprocess", "final-test", "upload"]) {
    const required = ancestors(id);
    assert.ok(required.has("pr-review"), `${id} requires the pipeline review`);
    assert.ok(required.has("select"), `${id} requires the frozen model selection`);
  }
  assert.ok(ancestors("final-test").has("preprocess"));
  assert.ok(ancestors("upload").has("final-test"));
});

test("rejoin inspection targets both personal worktrees without checking out shared main", () => {
  const step = byId.get("integrate");
  assert.ok(step?.commands);
  const commands = personaliseWorkshopText(step.commands, leon, repository);
  assert.ok(commands.includes(leon.pipelineBranch));
  assert.ok(commands.includes(leon.modelsBranch));
  assert.doesNotMatch(commands, /git (?:switch|checkout)\s+(?:-\S+\s+)*main(?:\s|$)/m);
  assert.doesNotMatch(commands, /git push\s+[^\n]*(?:\s|:)main(?:\s|$)/m);
});

test("copyable PR command explicitly targets the personal base and pipeline head", () => {
  const step = byId.get("pr-review");
  assert.ok(step?.commands);
  const commands = personaliseWorkshopText(step.commands, leon, repository);
  assert.match(commands, /--base\s+['"]?leon(?:['"]|\s|$)/);
  assert.match(commands, /--head\s+['"]?leon-pipeline_optimization(?:['"]|\s|$)/);
  assert.doesNotMatch(commands, /--base\s+['"]?main(?:['"]|\s|$)/);
});
