import assert from "node:assert/strict";
import test from "node:test";
const { codexTaskUrl } =
  await import(new URL("../lib/codex-links.ts", import.meta.url).href) as typeof import("../lib/codex-links");

test("the full personalized prompt survives URL encoding once", () => {
  const prompt = "On alex-pipeline, compare 2,048 → 4.\nUse alex-models & preserve 100% of IDs; seed 42.";
  const repository = "https://github.com/RingierIMU/mpx-data-engineering-workshop";
  const link = new URL(codexTaskUrl(prompt, repository));
  assert.equal(link.protocol, "codex:");
  assert.equal(link.hostname, "threads");
  assert.equal(link.pathname, "/new");
  assert.equal(link.searchParams.get("prompt"), prompt);
  assert.equal(link.searchParams.get("originUrl"), repository);
  assert.deepEqual([...link.searchParams.keys()], ["prompt", "originUrl"]);
});

test("initial folder setup can omit repository matching", () => {
  const link = new URL(codexTaskUrl("Check my setup", null));
  assert.equal(link.searchParams.get("prompt"), "Check my setup");
  assert.equal(link.searchParams.has("originUrl"), false);
});
