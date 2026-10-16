import assert from "node:assert/strict";
import test from "node:test";

const {
  assertProgressWriteContext, canonicalRepositoryUrl, MAX_PROGRESS_BYTES,
  parseProgressJson, ProgressError, readProgressMutation, validateProgressMutation,
} = await import(new URL("../lib/progress.ts", import.meta.url).href) as typeof import("../lib/progress");
const { workshopExercises } = await import(new URL("../components/workshop-content.ts", import.meta.url).href) as typeof import("../components/workshop-content");
const stepIds = new Set(workshopExercises.map((step) => step.id));
const request = (body: BodyInit | null, headers: Record<string, string> = {}) => new Request("https://workshop.example/api/progress", {
  method: "PATCH", body, headers: { "content-type": "application/json", ...headers },
  // Required only by Node for a streaming request body.
  ...((body instanceof ReadableStream) ? { duplex: "half" } : {}),
});
const isStatus = (status: number) => (error: unknown) => error instanceof ProgressError && error.status === status;

test("every current workshop step can be saved independently", () => {
  assert.equal(stepIds.size, workshopExercises.length);
  assert.ok(stepIds.has("explore-results"));
  for (const stepId of stepIds) {
    for (const completed of [true, false]) {
      const value = { action: "complete", stepId, completed };
      assert.deepEqual(validateProgressMutation(value, stepIds), value);
    }
  }
});

test("mutation validator rejects owner injection, wrong types, unknown steps and accidental whole-state updates", () => {
  const invalid: unknown[] = [
    null, [], "project", {}, { action: "reset" },
    { action: "complete", stepId: "unknown", completed: true },
    { action: "complete", stepId: "project", completed: "true" },
    { action: "complete", stepId: ["project"], completed: true },
    { action: "complete", stepId: "project" },
    { action: "complete", stepId: "project", completed: true, ownerId: "someone-else" },
    { action: "repository", repositoryUrl: null, user: { userId: "someone-else" } },
    { action: "repository" },
    { action: "repository", repositoryUrl: { url: "https://github.com/a/b" } },
    { action: "import", completedSteps: ["unknown"] },
    { action: "import", completedSteps: [null] },
    { action: "import", completedSteps: "project" },
    { action: "import", completedSteps: Array(stepIds.size + 1).fill("project") },
    { action: "import", completedSteps: [], repositoryUrl: undefined },
    { action: "import", completedSteps: [], email: "somebody@example.com" },
    { completedSteps: ["project"] },
  ];
  for (const value of invalid) assert.throws(() => validateProgressMutation(value, stepIds), ProgressError);
});

test("import normalizes duplicate checks without inventing or deleting steps", () => {
  assert.deepEqual(validateProgressMutation({ action: "import", completedSteps: ["smoke", "project", "smoke"] }, stepIds), {
    action: "import", completedSteps: ["smoke", "project"],
  });
  assert.deepEqual(validateProgressMutation({ action: "import", completedSteps: [], repositoryUrl: "https://GITHUB.com/team/workshop/" }, stepIds), {
    action: "import", completedSteps: [], repositoryUrl: "https://github.com/team/workshop",
  });
});

test("existing model progress does not automatically complete the new exploration step", () => {
  const completedSteps = ["experiments", "train", "select"];
  assert.deepEqual(validateProgressMutation({ action: "import", completedSteps }, stepIds), {
    action: "import", completedSteps,
  });
});

test("repository links accept HTTPS enterprise hosts and reject credential-bearing or ambiguous URLs", () => {
  assert.equal(canonicalRepositoryUrl(null), null);
  assert.equal(canonicalRepositoryUrl(" https://git.example.com/engineering/collision-lab.git/ "), "https://git.example.com/engineering/collision-lab.git");
  for (const value of [
    "", 42, undefined, "http://github.com/a/b", "javascript:alert(1)",
    "https://token@github.com/a/b", "https://user:secret@github.com/a/b",
    "https://github.com/a/b?token=secret", "https://github.com/a/b#secret",
    "https://github.com/a/b?", "https://github.com/a/b#",
    "https://github.com/a/b\n", "https://github.com/a/ b", "https://github.com/a/%62",
    "https://github.com/a/b/../repo", "https://github.com/a/b/c", "https://github.com/a",
    "https://github.com\\other/a/b", `https://github.com/a/${"b".repeat(2048)}`,
  ]) assert.throws(() => canonicalRepositoryUrl(value), ProgressError);
});

test("write context requires the exact displayed account and same-origin browser context", () => {
  const own = { origin: "https://workshop.example", "sec-fetch-site": "same-origin", "x-workshop-account": "account-A" };
  assert.doesNotThrow(() => assertProgressWriteContext(request("{}", own), "account-A"));
  assert.doesNotThrow(() => assertProgressWriteContext(request("{}", { "sec-fetch-site": "same-origin", "x-workshop-account": "account-A" }), "account-A"));
  assert.throws(() => assertProgressWriteContext(request("{}", { ...own, "x-workshop-account": "account-B" }), "account-A"), isStatus(409));
  assert.throws(() => assertProgressWriteContext(request("{}", { origin: own.origin }), "account-A"), isStatus(409));
  for (const changes of [
    { origin: "https://attacker.example" }, { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" },
  ]) assert.throws(() => assertProgressWriteContext(request("{}", { ...own, ...changes }), "account-A"), isStatus(403));
  assert.throws(() => assertProgressWriteContext(request("{}", { "x-workshop-account": "account-A" }), "account-A"), isStatus(403));
});

test("JSON parsing rejects deep nesting, duplicate fields and malformed documents", () => {
  for (const source of [
    "{", "{} trailing", '{"action":"complete","action":"import"}',
    '{"action":"complete","\\u0061ction":"import"}',
    '{"action":"import","completedSteps":[[["project"]]]}',
    '{"action":"complete","stepId":"unterminated}',
  ]) assert.throws(() => parseProgressJson(source), ProgressError);
  assert.deepEqual(parseProgressJson('{"action":"import","completedSteps":["project"]}'), { action: "import", completedSteps: ["project"] });
});

test("reader validates body content type and declared size before processing", async () => {
  await assert.rejects(readProgressMutation(request("{}", { "content-type": "text/plain" }), stepIds), isStatus(415));
  await assert.rejects(readProgressMutation(request("{}", { "content-length": String(MAX_PROGRESS_BYTES + 1) }), stepIds), isStatus(413));
  await assert.rejects(readProgressMutation(request("{}", { "content-length": "-1" }), stepIds), isStatus(413));
  await assert.rejects(readProgressMutation(request(null), stepIds), isStatus(400));
  assert.deepEqual(await readProgressMutation(request('{"action":"complete","stepId":"project","completed":true}', { "content-type": "application/json; charset=utf-8" }), stepIds), { action: "complete", stepId: "project", completed: true });
});

test("reader caps actual streamed UTF-8 bytes even when Content-Length is missing or lies", async () => {
  for (const headers of [{}, { "content-length": "1" }] as Record<string, string>[]) {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(MAX_PROGRESS_BYTES)); controller.enqueue(new Uint8Array(1)); },
      cancel() { cancelled = true; },
    });
    await assert.rejects(readProgressMutation(request(body, headers), stepIds), isStatus(413));
    assert.equal(cancelled, true);
  }
  const multibyte = new TextEncoder().encode(`{"action":"repository","repositoryUrl":"${"é".repeat(MAX_PROGRESS_BYTES / 2)}"}`);
  await assert.rejects(readProgressMutation(request(multibyte), stepIds), isStatus(413));
});

test("reader rejects broken UTF-8 instead of replacing characters", async () => {
  await assert.rejects(readProgressMutation(request(new Uint8Array([0xc3, 0x28])), stepIds), isStatus(400));
  await assert.rejects(readProgressMutation(request(new Uint8Array([0xc3])), stepIds), isStatus(400));
});
