import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { Evaluation, LeaderboardEntry, Model, Split } from "../lib/competition";

// Dynamic URL permits Node's native TS stripping without changing app tsconfig.
const {
  assertSubmissionWriteContext, bindParticipantSubmission, buildAwards, classificationMetrics, leaderboardParticipant, loadEvaluation,
  MAX_SUBMISSION_BYTES, parseSubmissionJson, readSubmission, REFERENCE_KERNEL,
  SubmissionError, teamIdentity, validateSubmission,
} = await import(new URL("../lib/competition.ts", import.meta.url).href) as typeof import("../lib/competition");
const { participantBranchCandidates } = await import(new URL("../lib/progress.ts", import.meta.url).href) as typeof import("../lib/progress");
const evaluation = JSON.parse(await readFile(new URL("../lib/server/evaluation.json", import.meta.url), "utf8")) as Evaluation;
const truth = await loadEvaluation(evaluation);

const perfectMetrics = (rows: { label: number }[]) => {
  const positive = rows.filter((row) => row.label === 1).length;
  const negative = rows.length - positive;
  return { rows: rows.length, signal_rows: positive, background_rows: negative,
    roc_auc: 1, average_precision: 1, accuracy: 1, f1: 1,
    confusion: { tn: negative, fp: 0, fn: 0, tp: positive }, signal_retention: 1, background_rejection: 1 };
};
function fixture() {
  return {
    version: 1, dataset_id: evaluation.dataset_id, experiment_id: "trees-final", run_id: "test-run-1",
    team: "Team Alpha", model: "xgboost", feature_names: ["jet_pt", "jet_sdmass"], feature_set: "basic",
    parameters: { n_estimators: 100, max_depth: 3 }, seed: 42, feature_source_sha256: "a".repeat(64),
    decision_threshold: 0.5, evaluated_splits: ["validation", "test"], test_selection: "final",
    metrics: { validation: perfectMetrics(evaluation.splits.validation), test: perfectMetrics(evaluation.splits.test) },
    timings: { training_seconds: 0.4, inference_seconds: 0.02, reference_seconds: 0.2, benchmark_rows: 128, repeat_count: 3, normalized_inference_time: 999 },
    hardware: { cpu_description: "Workshop CPU", threads_per_model: 1 },
    explanation: "Selected the measured-feature model on validation, then evaluated test once.",
    timestamp: "2026-10-12T09:53:04.357759+00:00",
    latency_protocol: { id: "jetclass2-cpu-128-v1", warmups: 1, repeats: 3, threads: 1, reference_iterations: 64, benchmark_rows: 128, reference_kernel: REFERENCE_KERNEL, includes_feature_matrix_or_tensor_conversion: true, includes_model_loading: false, batch_strategy: "one batch of 128 jets", validation_ids_sha256: truth.validation_ids_sha256 },
    predictions: (["validation", "test"] as Split[]).flatMap((split) => evaluation.splits[split].map((row) => ({ split, record_id: row.record_id, signal_score: row.label ? 0.8 : 0.2 }))),
  };
}
type Fixture = ReturnType<typeof fixture>;
const validated = () => bindParticipantSubmission(validateSubmission(fixture(), truth, "2026-10-12T12:00:00.000Z"), { id: "p-alpha", displayName: "Alpha" });

test("frozen dataset identity and latency sample hash match the workshop collector", () => {
  assert.equal(truth.dataset_id, "4f94bfde07e778e7dd0edd9e15fde722b32efae4c3c79d528c5803f5ce9260e0");
  assert.equal(truth.splits.validation.size, 1000);
  assert.equal(truth.splits.test.size, 1000);
  assert.equal(truth.validation_ids_sha256, "7b2396c443498fb9a421c89b9f6deb006c3e5fc2cba47c75553d9f14faae2418");
});
test("metrics handle ties with half ranks and grouped average precision", () => {
  const result = classificationMetrics([0, 1, 0, 1], [0.1, 0.4, 0.4, 0.9]);
  assert.equal(result.roc_auc, 0.875);
  assert.ok(Math.abs(result.average_precision! - 5 / 6) < 1e-12);
  assert.deepEqual(result.confusion, { tn: 2, fp: 0, fn: 1, tp: 1 });
  assert.equal(result.f1, 2 / 3);
});
test("identical scores yield AUC 0.5 and class-prior average precision", () => {
  const result = classificationMetrics([0, 1, 0, 1], [0.5, 0.5, 0.5, 0.5]);
  assert.equal(result.roc_auc, 0.5); assert.equal(result.average_precision, 0.5);
  assert.deepEqual(result.confusion, { tn: 0, fp: 2, fn: 0, tp: 2 });
});
test("single-class metrics keep undefined ranking values null", () => {
  const result = classificationMetrics([0, 0], [0.1, 0.2]);
  assert.equal(result.roc_auc, null); assert.equal(result.average_precision, null);
  assert.equal(result.f1, 0); assert.equal(result.signal_retention, null);
});
test("metrics reject invalid lengths, truth, scores and thresholds", () => {
  for (const args of [ [[], []], [[1], []], [[2], [0.3]], [[0], [NaN]], [[0], [Infinity]], [[0], [-0.1]], [[0], [1.1]], [[0], [0.5], NaN] ]) {
    assert.throws(() => classificationMetrics(...args as [number[], number[], number?]), SubmissionError);
  }
});
test("valid final payload is independently recomputed and private evidence omitted", () => {
  const entry = validated();
  assert.equal(entry.metrics.test!.roc_auc, 1);
  assert.equal(entry.reported_metrics_match, true);
  assert.ok(Math.abs(entry.timings.normalized_inference_time - 0.05) < 1e-12);
  assert.equal(entry.timings.relative_speed, 10);
  assert.equal(entry.timings.per_jet_ms, 0.15625);
  assert.equal(entry.updated_at, "2026-10-12T12:00:00.000Z");
  for (const key of ["predictions", "hardware", "ownerId", "email", "feature_source_sha256"]) assert.ok(!Object.hasOwn(entry, key));
});
test("reported quality and derived timing cannot change verified leaderboard values", () => {
  const payload = fixture(); payload.metrics.test.roc_auc = 0.1;
  const entry = validateSubmission(payload, truth);
  assert.equal(entry.metrics.test!.roc_auc, 1); assert.equal(entry.reported_metrics_match, false);
  assert.ok(Math.abs(entry.timings.normalized_inference_time - 0.05) < 1e-12);
});
test("validation-only entries are accepted but not ranked", () => {
  const payload = fixture(); payload.evaluated_splits = ["validation"]; payload.test_selection = "not_evaluated";
  payload.predictions = payload.predictions.filter((row) => row.split === "validation");
  const entry = validateSubmission(payload, truth);
  assert.equal(entry.metrics.test, undefined);
  assert.deepEqual(buildAwards([bindParticipantSubmission(entry, { id: "p-alpha", displayName: "Alpha" })]).quality, []);
});

const invalidCases: [string, (payload: Fixture) => void, RegExp][] = [
  ["wrong dataset", (p) => { p.dataset_id = "b".repeat(64); }, /different dataset/],
  ["unknown model", (p) => { p.model = "random_forest"; }, /Unknown model/],
  ["wrong version", (p) => { p.version = 2; }, /version/],
  ["missing prediction", (p) => { p.predictions.pop(); }, /complete fixed/],
  ["duplicate record", (p) => { p.predictions[1] = { ...p.predictions[0] }; }, /duplicate/],
  ["foreign record", (p) => { p.predictions[0].record_id = "foreign"; }, /unexpected split or record_id/],
  ["wrong split", (p) => { p.predictions[0].split = "test"; }, /unexpected split or record_id/],
  ["high score", (p) => { p.predictions[0].signal_score = 1.01; }, /scores must/],
  ["negative score", (p) => { p.predictions[0].signal_score = -0.01; }, /nonnegative/],
  ["NaN score", (p) => { p.predictions[0].signal_score = NaN; }, /finite/],
  ["zero inference time", (p) => { p.timings.inference_seconds = 0; }, /positive/],
  ["zero reference time", (p) => { p.timings.reference_seconds = 0; }, /positive/],
  ["negative training time", (p) => { p.timings.training_seconds = -1; }, /nonnegative/],
  ["overflowed normalized timing", (p) => { p.timings.inference_seconds = 1e308; p.timings.reference_seconds = 1e-308; }, /numeric range/],
  ["changed latency sample", (p) => { p.latency_protocol.validation_ids_sha256 = "b".repeat(64); }, /fixed 128/],
  ["wrong CPU threads", (p) => { p.latency_protocol.threads = 4; }, /fixed workshop protocol/],
  ["wrong repeat count", (p) => { p.timings.repeat_count = 2; }, /three measured repeats/],
  ["wrong batch strategy", (p) => { p.latency_protocol.batch_strategy = "one jet per ONNX call"; }, /batch strategy/],
  ["test not final", (p) => { p.test_selection = "not_evaluated"; }, /final selection/],
  ["reordered splits", (p) => { p.evaluated_splits.reverse(); }, /Evaluate validation/],
  ["truth leakage", (p) => { p.feature_names.push("truth_label"); }, /not prediction features/],
  ["generator leakage", (p) => { p.feature_names.push("genpart_pid"); }, /not prediction features/],
  ["duplicated feature", (p) => { p.feature_names.push("jet_pt"); }, /unique list/],
  ["invalid seed", (p) => { p.seed = 2 ** 32; }, /seed/],
  ["missing checksum", (p) => { p.feature_source_sha256 = "invalid"; }, /checksum/],
  ["threshold changed", (p) => { p.decision_threshold = 0.6; }, /fixed threshold/],
  ["timezone absent", (p) => { p.timestamp = "2026-10-12T12:00:00"; }, /timezone/],
  ["nonexistent date", (p) => { p.timestamp = "2026-02-30T12:00:00Z"; }, /valid ISO/],
  ["invalid midnight hour", (p) => { p.timestamp = "2026-10-12T24:00:00Z"; }, /valid ISO/],
  ["unsafe run ID", (p) => { p.run_id = "../../run"; }, /run_id/],
];
for (const [name, mutate, message] of invalidCases) test(`rejects ${name}`, () => {
  const payload = fixture(); mutate(payload); assert.throws(() => validateSubmission(payload, truth), message);
});

test("unknown fields, code-like parameters and booleans masquerading as numbers are rejected", () => {
  assert.throws(() => validateSubmission({ ...fixture(), path: "/tmp/model" }, truth), /unexpected fields/);
  assert.throws(() => validateSubmission({ ...fixture(), parameters: { code: "run()" } }, truth), /supported numeric/);
  assert.throws(() => validateSubmission({ ...fixture(), parameters: { max_depth: true } }, truth), /finite/);
  assert.throws(() => validateSubmission({ ...fixture(), timings: { ...fixture().timings, repeat_count: true } }, truth), /three measured/);
});
test("Sophon requires the frozen batch, threading and latency protocol", () => {
  const payload = { ...fixture(), model: "sophon", parameters: { batch_size: 1, threads: 1 } };
  payload.latency_protocol.batch_strategy = "one jet per ONNX call";
  const entry = validateSubmission(payload, truth);
  assert.equal(buildAwards([bindParticipantSubmission(entry, { id: "p-alpha", displayName: "Alpha" })]).references.length, 1);
  assert.equal(buildAwards([bindParticipantSubmission(entry, { id: "p-alpha", displayName: "Alpha" })]).quality.length, 0);
  payload.parameters.batch_size = 4;
  assert.throws(() => validateSubmission(payload, truth), /Sophon is frozen/);
});

test("strict JSON parser rejects ambiguity and retains ordinary JSON strings", () => {
  const parsed = parseSubmissionJson('{"team":"a\\\"b","flag":true,"list":[1,null,"λ"]}');
  assert.equal(parsed.team, 'a"b');
  assert.deepEqual(parsed.list, [1, null, "λ"]);
  for (const invalid of ['{"a":1,"a":2}', '{"x":{"a":1,"\\u0061":2}}', '{"a":NaN}', '{"a":Infinity}', '{"a":1e999}', '{"a":1,}', '[1]', '{"a":01}', '{"a":true} garbage', '{"a":1}\u00a0']) {
    assert.throws(() => parseSubmissionJson(invalid), SubmissionError);
  }
});
test("JSON limits apply before validation", () => {
  assert.throws(() => parseSubmissionJson(JSON.stringify({ text: "x".repeat(2001) })), /2,000/);
  assert.throws(() => parseSubmissionJson('{"a":' + '['.repeat(9) + '0' + ']'.repeat(9) + '}'), /eight levels/);
  assert.throws(() => parseSubmissionJson(JSON.stringify(Object.fromEntries(Array.from({length: 101}, (_, i) => [`x${i}`, i])))), /limit/);
  assert.throws(() => parseSubmissionJson(JSON.stringify({ rows: new Array(5001).fill(0) })), /limit/);
});
test("streamed file parser accepts an ordinary submission", async () => {
  const parsed = await readSubmission(new Request("https://test.local", { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(fixture()) }));
  assert.equal(validateSubmission(parsed, truth).metrics.test!.roc_auc, 1);
});
test("streamed upload size enforcement works without Content-Length and cancels the stream", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(MAX_SUBMISSION_BYTES)); controller.enqueue(new Uint8Array(1)); },
    cancel() { cancelled = true; },
  });
  const request = new Request("https://test.local", { method: "POST", headers: { "Content-Type": "application/json" }, body, duplex: "half" } as RequestInit & { duplex: string });
  await assert.rejects(readSubmission(request), (error: unknown) => error instanceof SubmissionError && error.status === 413);
  assert.equal(cancelled, true);
});
test("rejects oversized declared lengths and non-JSON MIME types", async () => {
  await assert.rejects(readSubmission(new Request("https://test.local", { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": "1000001" }, body: "{}" })), (error: unknown) => error instanceof SubmissionError && error.status === 413);
  await assert.rejects(readSubmission(new Request("https://test.local", { method: "POST", body: "{}" })), (error: unknown) => error instanceof SubmissionError && error.status === 415);
});
test("rejects malformed UTF-8 instead of silently replacing it", async () => {
  await assert.rejects(readSubmission(new Request("https://test.local", { method: "POST", headers: { "Content-Type": "application/json" }, body: new Uint8Array([0xc3, 0x28]) })), /UTF-8/);
});

function rankedCandidate(name: string, auc: number, time: number, model: Model = "xgboost"): LeaderboardEntry {
  const entry = validated(); entry.participant = { id: `p-${name.toLowerCase()}`, displayName: name }; entry.model = model;
  entry.metrics.test!.roc_auc = auc; entry.timings.normalized_inference_time = time;
  return entry;
}
test("awards keep quality and eligible efficiency separate; exclude Sophon and validation", () => {
  const validation = rankedCandidate("Validation", 1, 0.0001); validation.test_selection = "not_evaluated";
  const result = buildAwards([
    rankedCandidate("Quality", 0.9, 4), rankedCandidate("Efficient", 0.88, 1),
    rankedCandidate("Too weak", 0.87999, 0.1), rankedCandidate("Frozen", 0.99, 0.001, "sophon"), validation,
  ]);
  assert.deepEqual(result.quality.map((r) => r.participant.displayName), ["Quality", "Efficient", "Too weak"]);
  assert.deepEqual(result.efficiency.map((r) => r.participant.displayName), ["Efficient", "Quality"]);
  assert.equal(result.best_test_auc, 0.9);
  assert.equal(result.references[0].participant.displayName, "Frozen");
});
test("rank ties are deterministic and each participant receives at most one place", () => {
  const result = buildAwards([rankedCandidate("Beta", 0.9, 1), rankedCandidate("Alpha", 0.9, 1), rankedCandidate("Alpha", 0.88, 0.5)]);
  assert.deepEqual(result.quality.map((r) => r.participant.displayName), ["Alpha", "Beta"]);
  assert.deepEqual(result.efficiency.map((r) => r.participant.displayName), ["Alpha", "Beta"]);
  assert.deepEqual(result.quality.map((r) => r.rank), [1, 2]);
});
test("empty leaderboard is empty with no seeded results", () => {
  const result = buildAwards([]);
  assert.deepEqual(result.quality, []); assert.deepEqual(result.efficiency, []);
  assert.deepEqual(result.references, []); assert.equal(result.best_test_auc, null);
});
test("aliases normalize case and spacing and reject invisible names", () => {
  assert.deepEqual(teamIdentity("  Team   Alpha  "), { team: "Team Alpha", key: "team alpha" });
  assert.equal(teamIdentity("Ｔｅａｍ Alpha").key, "team alpha");
  assert.throws(() => teamIdentity("Team\u200bAlpha"), /control characters/);
  assert.throws(() => teamIdentity("  "), /nonempty/);
});
test("uploaded aliases never choose the owner or become public identity", () => {
  const alpha = { id: "p-alpha", displayName: "Alex" };
  const beta = { id: "p-beta", displayName: "Alex" };
  const first = bindParticipantSubmission(validateSubmission({ ...fixture(), team: "Claimed by Beta" }, truth), alpha);
  const renamed = bindParticipantSubmission(validateSubmission({ ...fixture(), team: "Another alias" }, truth), alpha);
  const other = bindParticipantSubmission(validateSubmission({ ...fixture(), team: "Claimed by Beta" }, truth), beta);
  assert.deepEqual(first.participant, alpha);
  assert.deepEqual(renamed.participant, alpha);
  assert.deepEqual(other.participant, beta);
  assert.ok(!Object.hasOwn(first, "team"));
  assert.deepEqual(first.metrics, other.metrics);
  assert.deepEqual(first.timings, other.timings);
  const awards = buildAwards([first, renamed, other]);
  assert.deepEqual(awards.quality.map((entry) => entry.participant.id), ["p-alpha", "p-beta"]);
  assert.deepEqual(awards.quality.map((entry) => entry.participant.displayName), ["Alex", "Alex"]);
});
test("legacy rows retain metrics but not their old team identity", () => {
  const legacy = { ...validateSubmission(fixture(), truth), team: "Old alias" };
  const entry = bindParticipantSubmission(legacy, leaderboardParticipant("p-alpha", null));
  assert.equal(entry.participant.displayName, "p-alpha");
  assert.deepEqual(entry.metrics, legacy.metrics);
  assert.ok(!Object.hasOwn(entry, "team"));
});
test("profile labels never fall back to email and normalize visible names", () => {
  assert.deepEqual(leaderboardParticipant("p-alpha", "  Léon   Jouet  "), { id: "p-alpha", displayName: "Léon Jouet" });
  for (const name of [null, "", "  ", "\u200b", "person@example.com", "a".repeat(81)]) {
    assert.equal(leaderboardParticipant("p-alpha", name).displayName, "p-alpha");
  }
  assert.equal(leaderboardParticipant("p-alpha", "Alex\u200b Smith").displayName, "Alex Smith");
});
test("submission writes require same origin and the account shown during file selection", () => {
  const request = (headers: Record<string, string>) => new Request("https://workshop.example/api/leaderboard", { method: "POST", headers });
  assert.doesNotThrow(() => assertSubmissionWriteContext(request({ origin: "https://workshop.example", "x-workshop-account": "user-a" }), "user-a"));
  assert.doesNotThrow(() => assertSubmissionWriteContext(request({ "sec-fetch-site": "same-origin", "x-workshop-account": "user-a" }), "user-a"));
  const rejectedHeaders: Record<string, string>[] = [{}, { origin: "https://other.example" }, { origin: "https://workshop.example", "sec-fetch-site": "same-site" }];
  for (const headers of rejectedHeaders) {
    assert.throws(() => assertSubmissionWriteContext(request({ "x-workshop-account": "user-a", ...headers }), "user-a"), (error: unknown) => error instanceof SubmissionError && error.status === 403);
  }
  for (const account of ["", "user-b"]) {
    assert.throws(() => assertSubmissionWriteContext(request({ origin: "https://workshop.example", "x-workshop-account": account }), "user-a"), (error: unknown) => error instanceof SubmissionError && error.status === 409);
  }
});
test("canonical evaluation rejects overlapping IDs and nonbinary labels", async () => {
  const duplicate = structuredClone(evaluation); duplicate.splits.test[0].record_id = duplicate.splits.validation[0].record_id;
  await assert.rejects(loadEvaluation(duplicate), /valid and disjoint/);
  const wrongLabel = structuredClone(evaluation); wrongLabel.splits.test[0].label = 2;
  await assert.rejects(loadEvaluation(wrongLabel), /binary labels/);
});


test("personal branch preferences use trusted first names and deterministic collision fallbacks", () => {
  const id = "p-1234567890abcdef";
  assert.deepEqual(participantBranchCandidates("  Léon Jouet  ", id), ["leon", "leon-12345678", "participant-1234567890abcdef"]);
  assert.equal(participantBranchCandidates("Anne-Marie Taylor", id)[0], "anne-marie");
  assert.notEqual(participantBranchCandidates("Léon Smith", "p-abcdef1234567890")[1], participantBranchCandidates("Léon Jouet", id)[1]);
  for (const name of [null, "", "main", "HEAD", "master", "person@example.com", "123 Alex", "!", "中文"]) {
    assert.equal(participantBranchCandidates(name, id)[0], "participant-1234567890abcdef");
  }
  for (const candidate of participantBranchCandidates("-" + "A".repeat(80), id)) {
    assert.match(candidate, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(candidate.length <= 32);
  }
  assert.throws(() => participantBranchCandidates("Léon", "../../bad"), /Invalid participant/);
});
