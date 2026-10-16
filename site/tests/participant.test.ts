import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const { participantWorkspaceFor, personaliseWorkshopText, workspaceForParticipant } =
  await import(new URL("../lib/participant.ts", import.meta.url).href) as typeof import("../lib/participant");
const { participantBranchCandidates } =
  await import(new URL("../lib/progress.ts", import.meta.url).href) as typeof import("../lib/progress");
const { coreWorkshopExercises, optionalWorkshopExercises, workshopExercises } =
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

test("every displayed workflow field personalises for different authenticated participants", () => {
  for (const workspace of [leon, secondLeon]) {
    for (const step of workshopExercises) {
      const templates: Record<string, string | undefined> = {
        title: step.title,
        instruction: step.instruction,
        hint: step.hint,
        prompt: step.prompt,
        checkpoint: step.checkpoint,
        commands: step.commands,
        commandTitle: step.commandTitle,
        decision: step.decision,
        time: step.time,
        "concept.title": step.concept?.title,
        "concept.body": step.concept?.body,
      };
      step.actions?.forEach((action, index) => { templates[`actions.${index}`] = action; });
      step.extraPrompts?.forEach((extra, index) => {
        templates[`extraPrompts.${index}.title`] = extra.title;
        templates[`extraPrompts.${index}.prompt`] = extra.prompt;
      });
      for (const [field, template] of Object.entries(templates)) {
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
  assert.ok(ancestors("download-data").has("codex-project"));
  assert.ok(ancestors("project").has("download-data"));
  assert.ok(ancestors("overview").has("project"));
  assert.ok(ancestors("smoke").has("overview"));
  assert.ok(ancestors("profile").has("worktrees"));
  assert.ok(ancestors("experiments").has("worktrees"));
  assert.ok(!ancestors("profile").has("experiments"));
  assert.ok(!ancestors("experiments").has("profile"));
  assert.ok(!ancestors("select").has("pr-review"));
  assert.ok(!ancestors("pr-review").has("select"));
});

test("model results are explored after training and before selection", () => {
  const modelSteps = coreWorkshopExercises.filter((step) => step.location === "models");
  assert.deepEqual(modelSteps.map((step) => step.id), ["experiments", "train", "explore-results", "select"]);
  assert.equal(byId.get("explore-results")?.title, "Explore results");
  assert.deepEqual(byId.get("explore-results")?.dependsOn, ["train"]);
  assert.deepEqual(byId.get("select")?.dependsOn, ["explore-results"]);
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

test("core completion never requires an optional exercise", () => {
  const optionalIds = new Set(optionalWorkshopExercises.map((step) => step.id));
  assert.deepEqual([...optionalIds], ["sophon-reference"]);
  assert.deepEqual(coreWorkshopExercises.slice(-2).map(step => step.id), ["final-test", "upload"]);
  assert.ok(!byId.has("results-site"));
  for (const step of coreWorkshopExercises) {
    assert.ok(!step.optional, `${step.id} is marked optional but included in core progress`);
    assert.ok(!optionalIds.has(step.id), `${step.id} is included in both core and optional progress`);
    for (const dependency of ancestors(step.id)) {
      assert.ok(!optionalIds.has(dependency), `${step.id} requires optional ${dependency}`);
    }
  }
  for (const step of optionalWorkshopExercises) assert.equal(step.optional, true);
});

test("participant merges through the UI and only fast-forwards their local personal branch", () => {
  const step = byId.get("integrate");
  assert.ok(step?.commands);
  assert.equal(step.prompt, undefined, "Merging is a participant-operated UI action, not an agent prompt");
  const commands = personaliseWorkshopText(step.commands, leon, repository);
  assert.match(commands, /git pull --ff-only origin ['"]?leon['"]?(?:\n|$)/);
  assert.doesNotMatch(commands, /\b(?:gh pr merge|git merge)\b/);
  assert.doesNotMatch(commands, /git (?:switch|checkout)\s+(?:-\S+\s+)*main(?:\s|$)/m);
  assert.doesNotMatch(commands, /git push\s+[^\n]*(?:\s|:)main(?:\s|$)/m);
});

test("each lane asks Codex to push and create a PR into the participant's personal branch", () => {
  for (const workspace of [leon, secondLeon]) {
    for (const [id, head] of [["pr-review", workspace.pipelineBranch], ["select", workspace.modelsBranch]]) {
      const step = byId.get(id);
      assert.ok(step?.prompt);
      const prompt = personaliseWorkshopText(step.prompt, workspace, repository);
      assert.ok(prompt.includes(head), `${id} identifies its own head branch`);
      assert.ok(prompt.includes(`into ${workspace.branch}`), `${id} targets its participant's base branch`);
      assert.match(prompt, /\bpush\b/i);
      assert.match(prompt, /\bcreate a PR\b/);
      assert.doesNotMatch(prompt, /\binto main\b/);
    }
  }
});


test("named runs separate every executable name while retaining account identity", () => {
  const first = workspaceForParticipant(idA, "leon-test1", "leon-test1");
  const second = workspaceForParticipant(idA, "leon-test2", "leon-test2");
  assert.equal(first.id, second.id);
  for (const key of ["branch", "pipelineBranch", "modelsBranch", "composePrefix"] as const) assert.notEqual(first[key], second[key]);
  assert.equal(personaliseWorkshopText("name: {{runName}}", second, null), "name: leon-test2");
  assert.throws(() => workspaceForParticipant(idA, "leon-test1", "different"));
  for (const step of workshopExercises) {
    const prompt = [step.prompt, ...(step.extraPrompts ?? []).map(p => p.prompt)].join("\n");
    assert.ok(!/team:|participantId/.test(prompt));
  }
});
