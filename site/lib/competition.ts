/** Version-1 workshop contract, ported from the trusted Python collector.
 * Pure functions only: canonical labels live in lib/server and are route-only.
 */
export const MAX_SUBMISSION_BYTES = 1_000_000;
export const MAX_PREDICTIONS = 5_000;
export const QUALITY_MARGIN = 0.02;
export const REFERENCE_KERNEL = "64 float64 256x256 matrix products; seed 42; one BLAS thread; median of 3 after 1 warmup";
const FIELDS = ["version", "dataset_id", "experiment_id", "run_id", "team", "model", "feature_names", "feature_set", "parameters", "seed", "feature_source_sha256", "decision_threshold", "evaluated_splits", "test_selection", "metrics", "timings", "hardware", "explanation", "timestamp", "latency_protocol", "predictions"];

type JsonObject = Record<string, unknown>;
export type Split = "validation" | "test";
export type Model = "logistic" | "xgboost" | "sophon";
export type Metrics = {
  rows: number; signal_rows: number; background_rows: number;
  roc_auc: number | null; average_precision: number | null; accuracy: number; f1: number;
  confusion: { tn: number; fp: number; fn: number; tp: number };
  signal_retention: number | null; background_rejection: number | null;
};
export type Timings = {
  training_seconds: number; inference_seconds: number; reference_seconds: number;
  benchmark_rows: 128; repeat_count: 3; per_jet_ms: number;
  relative_speed: number; normalized_inference_time: number;
};
export type LeaderboardParticipant = { id: string; displayName: string };
export type SubmissionResult = {
  experiment_id: string; run_id: string; model: Model;
  feature_set: string; feature_names: string[]; parameters: Record<string, number>;
  seed: number; explanation: string; timestamp: string; updated_at: string;
  test_selection: "final" | "not_evaluated";
  metrics: Partial<Record<Split, Metrics>>; timings: Timings;
  reported_metrics_match: boolean; metrics_recomputed: true; self_reported: true;
};
export type LeaderboardEntry = SubmissionResult & { participant: LeaderboardParticipant };
/** Read compatibility for rows saved before individual participation. */
export type LegacyLeaderboardEntry = SubmissionResult & { team: string };
export type StoredLeaderboardEntry = LeaderboardEntry | LegacyLeaderboardEntry;
export type RankedEntry = LeaderboardEntry & { rank: number; test_auc: number; normalized_inference_time: number };
export type Awards = {
  quality: RankedEntry[]; efficiency: RankedEntry[]; references: LeaderboardEntry[];
  best_test_auc: number | null; quality_margin: number; rules: string; timing_caveat: string;
};
export type LeaderboardResponse = {
  entries: LeaderboardEntry[]; awards: Awards; dataset_id: string;
  authenticated: boolean;
  /** Current authenticated participant, even before their first upload. */
  participant: LeaderboardParticipant | null;
  /** Only the current account's saved result; never selected by display name. */
  own_entry: LeaderboardEntry | null;
  max_upload_bytes: number;
};
export type Evaluation = { version: 1; dataset_id: string; splits: Record<Split, { record_id: string; label: number }[]> };
export type Truth = { dataset_id: string; splits: Record<Split, Map<string, number>>; validation_ids_sha256: string };

export class SubmissionError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.name = "SubmissionError"; this.status = status; }
}
function fail(message: string): never { throw new SubmissionError(message); }
function object(value: unknown, name: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(`${name} must be an object.`);
  return value as JsonObject;
}
function exactFields(value: JsonObject, fields: string[], name: string) {
  if (Object.keys(value).length !== fields.length || fields.some((key) => !Object.hasOwn(value, key))) fail(`${name} has missing or unexpected fields.`);
}
function text(value: unknown, name: string, maximum = 128): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) fail(`${name} must be a nonempty string of at most ${maximum} characters.`);
  return value;
}
function number(value: unknown, name: string, positive = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || (positive && value === 0)) fail(`${name} must be a finite ${positive ? "positive" : "nonnegative"} number.`);
  return value;
}
function validTimestamp(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= monthDays[month - 1]
    && hour < 24 && minute < 60 && second < 60;
}
function boundedJson(value: unknown, depth = 0): void {
  if (depth > 8) fail("JSON nesting exceeds eight levels.");
  if (typeof value === "number" && !Number.isFinite(value)) fail("JSON numbers must be finite.");
  if (typeof value === "string" && value.length > 2_000) fail("Submission text fields must be at most 2,000 characters.");
  if (Array.isArray(value)) {
    if (value.length > MAX_PREDICTIONS) fail("JSON arrays exceed the submission row limit.");
    for (const child of value) boundedJson(child, depth + 1);
  } else if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length > 100) fail("JSON objects may contain at most 100 fields.");
    for (const [key, child] of entries) {
      if (key.length > 128) fail("JSON field names must be short strings.");
      boundedJson(child, depth + 1);
    }
  }
}

/** Reject duplicate keys before parsing can silently discard their earlier value. */
export function parseSubmissionJson(source: string): JsonObject {
  let offset = 0;
  const whitespace = () => { while (offset < source.length && /[\t\r\n ]/.test(source[offset])) offset++; };
  const invalid = (): never => fail("Upload a valid JSON submission file.");
  const string = (): string => {
    const start = offset++;
    while (offset < source.length) {
      const character = source[offset++];
      if (character === "\\") offset++;
      else if (character === '"') {
        try { return JSON.parse(source.slice(start, offset)) as string; } catch { return invalid(); }
      }
    }
    return invalid();
  };
  const value = (depth: number): unknown => {
    if (depth > 8) fail("JSON nesting exceeds eight levels.");
    whitespace();
    const first = source[offset];
    if (first === '"') return string();
    if (first === "{" || first === "[") {
      offset++; whitespace();
      const isObject = first === "{";
      const close = isObject ? "}" : "]";
      const result: JsonObject | unknown[] = isObject ? Object.create(null) : [];
      const keys = new Set<string>();
      let count = 0;
      if (source[offset] === close) { offset++; return result; }
      while (offset < source.length) {
        if (++count > (isObject ? 100 : MAX_PREDICTIONS)) fail("JSON object or array exceeds the submission limit.");
        whitespace();
        if (isObject) {
          if (source[offset] !== '"') return invalid();
          const key = string();
          if (keys.has(key)) fail(`Duplicate JSON key: ${key.slice(0, 128)}`);
          if (key.length > 128) fail("JSON field names must be short strings.");
          keys.add(key); whitespace();
          if (source[offset++] !== ":") return invalid();
          (result as JsonObject)[key] = value(depth + 1);
        } else (result as unknown[]).push(value(depth + 1));
        whitespace();
        const next = source[offset++];
        if (next === close) return result;
        if (next !== ",") return invalid();
      }
      return invalid();
    }
    const token = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(source.slice(offset));
    if (!token) return invalid();
    offset += token[0].length;
    return JSON.parse(token[0]);
  };
  const result = value(0); whitespace();
  if (offset !== source.length) invalid();
  boundedJson(result);
  return object(result, "Submission");
}

/** Enforce the cap while streaming, including without Content-Length. */
export async function readSubmission(request: Request): Promise<JsonObject> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) throw new SubmissionError("Upload the JSON file as application/json.", 415);
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_SUBMISSION_BYTES)) throw new SubmissionError("Submission exceeds the 1 MB upload limit.", 413);
  if (!request.body) fail("Submission file is empty.");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0; let source = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_SUBMISSION_BYTES) { await reader.cancel(); throw new SubmissionError("Submission exceeds the 1 MB upload limit.", 413); }
      source += decoder.decode(next.value, { stream: true });
    }
    source += decoder.decode();
  } catch (error) {
    if (error instanceof SubmissionError) throw error;
    fail("Submission could not be read as UTF-8 JSON.");
  } finally { reader.releaseLock(); }
  return parseSubmissionJson(source);
}

export function classificationMetrics(labels: number[], scores: number[], threshold = 0.5): Metrics {
  if (!labels.length || labels.length !== scores.length || typeof threshold !== "number" || !Number.isFinite(threshold) || threshold < 0 || threshold > 1 || labels.some((label) => label !== 0 && label !== 1) || scores.some((score) => typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1)) fail("Metrics require aligned binary truth and finite scores in [0, 1].");
  const positives = labels.reduce((sum, label) => sum + label, 0);
  const negatives = labels.length - positives;
  const groups = new Map<number, [number, number]>();
  let tp = 0; let fp = 0;
  labels.forEach((label, i) => {
    const group = groups.get(scores[i]) ?? [0, 0]; group[label]++; groups.set(scores[i], group);
    if (scores[i] >= threshold) { if (label === 1) tp++; else fp++; }
  });
  const sorted = [...groups.keys()].sort((a, b) => a - b);
  let below = 0; let rankSum = 0;
  for (const score of sorted) {
    const [background, signal] = groups.get(score)!; const count = background + signal;
    rankSum += signal * (below + (count + 1) / 2); below += count;
  }
  let selectedSignal = 0; let selectedTotal = 0; let averagePrecision = 0;
  for (const score of sorted.reverse()) {
    const [background, signal] = groups.get(score)!;
    selectedSignal += signal; selectedTotal += background + signal;
    if (positives) averagePrecision += signal / positives * selectedSignal / selectedTotal;
  }
  const fn = positives - tp; const tn = negatives - fp;
  return { rows: labels.length, signal_rows: positives, background_rows: negatives,
    roc_auc: positives && negatives ? (rankSum - positives * (positives + 1) / 2) / (positives * negatives) : null,
    average_precision: positives ? averagePrecision : null, accuracy: (tp + tn) / labels.length,
    f1: tp + fp + fn ? 2 * tp / (2 * tp + fp + fn) : 0,
    confusion: { tn, fp, fn, tp }, signal_retention: positives ? tp / positives : null,
    background_rejection: negatives ? tn / negatives : null };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function loadEvaluation(reference: Evaluation): Promise<Truth> {
  exactFields(object(reference, "Evaluation"), ["version", "dataset_id", "splits"], "Evaluation");
  if (reference.version !== 1 || !/^[0-9a-f]{64}$/.test(reference.dataset_id)) fail("Invalid canonical evaluation contract.");
  exactFields(object(reference.splits, "Evaluation splits"), ["validation", "test"], "Evaluation splits");
  const splits: Truth["splits"] = { validation: new Map(), test: new Map() };
  const seen = new Set<string>();
  for (const split of ["validation", "test"] as const) {
    if (!Array.isArray(reference.splits[split])) fail("Invalid canonical evaluation split.");
    for (const row of reference.splits[split]) {
      exactFields(object(row, "Evaluation row"), ["record_id", "label"], "Evaluation row");
      if (typeof row.record_id !== "string" || seen.has(row.record_id) || (row.label !== 0 && row.label !== 1)) fail("Canonical evaluation IDs and binary labels must be valid and disjoint.");
      seen.add(row.record_id); splits[split].set(row.record_id, row.label);
    }
    if (new Set(splits[split].values()).size !== 2) fail("Each canonical evaluation split requires both truth groups.");
  }
  const identifiers = [...splits.validation.keys()].sort().slice(0, 128);
  if (identifiers.length !== 128) fail("Canonical validation split must contain at least 128 rows.");
  return { dataset_id: reference.dataset_id, splits, validation_ids_sha256: await sha256(`${identifiers.join("\n")}\n`) };
}

function metricsMatch(actual: unknown, expected: unknown): boolean {
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
    const a = actual as JsonObject; const e = expected as JsonObject;
    return Object.keys(a).length === Object.keys(e).length && Object.entries(e).every(([key, value]) => Object.hasOwn(a, key) && metricsMatch(a[key], value));
  }
  if (typeof expected === "number") return typeof actual === "number" && Number.isFinite(actual) && Math.abs(actual - expected) <= Math.max(1e-9, 1e-7 * Math.max(Math.abs(actual), Math.abs(expected)));
  return actual === expected;
}

export function teamIdentity(value: unknown): { team: string; key: string } {
  const original = text(value, "team", 80);
  const team = original.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!team || team.length > 80 || /[\p{Cc}\p{Cf}]/u.test(original)) fail("The version-1 submission tag must contain visible text of at most 80 characters without control characters.");
  return { team, key: team.toLowerCase() };
}
/** Public labels come from the trusted profile; email fallback is never published. */
export function leaderboardParticipant(id: string, fullName: string | null): LeaderboardParticipant {
  const name = fullName?.normalize("NFKC").replace(/[\p{Cc}\p{Cf}]/gu, "").trim().replace(/\s+/g, " ");
  return { id, displayName: name && name.length <= 80 && !name.includes("@") ? name : id };
}

/** Explicitly copy result fields so uploaded/legacy aliases cannot become identity. */
export function bindParticipantSubmission(entry: SubmissionResult, participant: LeaderboardParticipant): LeaderboardEntry {
  return {
    participant, experiment_id: entry.experiment_id, run_id: entry.run_id, model: entry.model,
    feature_set: entry.feature_set, feature_names: entry.feature_names, parameters: entry.parameters,
    seed: entry.seed, explanation: entry.explanation, timestamp: entry.timestamp, updated_at: entry.updated_at,
    test_selection: entry.test_selection, metrics: entry.metrics, timings: entry.timings,
    reported_metrics_match: entry.reported_metrics_match, metrics_recomputed: entry.metrics_recomputed,
    self_reported: entry.self_reported,
  };
}

/** Match both origin and the account displayed when the participant selected the file. */
export function assertSubmissionWriteContext(request: Request, authenticatedSubject: string): void {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if ((origin && origin !== new URL(request.url).origin) || (fetchSite && fetchSite !== "same-origin") || (!origin && fetchSite !== "same-origin")) {
    throw new SubmissionError("Upload results from this site's leaderboard page.", 403);
  }
  if (request.headers.get("x-workshop-account") !== authenticatedSubject) {
    throw new SubmissionError("Your signed-in account changed. Refresh before selecting your results file again.", 409);
  }
}

export function validateSubmission(input: unknown, truth: Truth, now = new Date().toISOString()): SubmissionResult {
  const payload = object(input, "Submission"); exactFields(payload, FIELDS, "Submission"); boundedJson(payload);
  if (payload.version !== 1) fail("Submission version must be 1.");
  if (payload.dataset_id !== truth.dataset_id) fail("Submission belongs to a different dataset.");
  const experimentId = text(payload.experiment_id, "experiment_id");
  const runId = text(payload.run_id, "run_id");
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(runId)) fail("run_id must be 1–80 letters, numbers, '-' or '_'.");
  // Version 1 calls this field team. Keep file compatibility without trusting its identity.
  teamIdentity(payload.team);
  const featureSet = text(payload.feature_set, "feature_set");
  const timestamp = text(payload.timestamp, "timestamp");
  if (!validTimestamp(timestamp)) fail("Submission timestamp must be a valid ISO 8601 date with a timezone.");
  if (payload.model !== "sophon" && payload.model !== "xgboost" && payload.model !== "logistic") fail("Unknown model; use sophon, xgboost or logistic.");
  const model: Model = payload.model;
  const names = payload.feature_names;
  if (!Array.isArray(names) || names.length === 0 || names.length > 100 || names.some((name) => typeof name !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)) || new Set(names).size !== names.length) fail("feature_names must be a nonempty, unique list of column names.");
  if ((names as string[]).some((name) => ["truth_label", "truth_group", "record_id", "source_file", "source_row", "split", "jet_label"].includes(name) || /^(genpart_|genjet_|aux_genpart_)/.test(name))) fail("Labels, identities and generator truth are not prediction features.");
  for (const key of ["parameters", "hardware", "latency_protocol", "timings", "metrics"]) object(payload[key], key);
  const parameters = payload.parameters as JsonObject;
  const allowed: Record<Model, string[]> = { logistic: ["C", "max_iter"], xgboost: ["n_estimators", "max_depth", "learning_rate", "subsample", "colsample_bytree", "min_child_weight", "reg_lambda"], sophon: ["batch_size", "threads"] };
  if (Object.keys(parameters).some((key) => !allowed[model].includes(key))) fail("Submission parameters must be supported numeric model settings, not paths or code.");
  for (const [key, value] of Object.entries(parameters)) number(value, `parameter ${key}`);
  if (model === "sophon" && (Object.keys(parameters).length !== 2 || parameters.batch_size !== 1 || parameters.threads !== 1)) fail("Sophon is frozen and must use batch size 1 and one thread.");
  if (typeof payload.seed !== "number" || !Number.isInteger(payload.seed) || payload.seed < 0 || payload.seed >= 2 ** 32) fail("seed must be an integer between 0 and 2^32−1.");
  if (typeof payload.feature_source_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(payload.feature_source_sha256)) fail("Missing feature source checksum.");
  const explanation = text(payload.explanation, "explanation", 2_000);
  if (payload.decision_threshold !== 0.5) fail("This teaching protocol uses the fixed threshold 0.5.");
  const splits = payload.evaluated_splits;
  if (!Array.isArray(splits) || (JSON.stringify(splits) !== '["validation"]' && JSON.stringify(splits) !== '["validation","test"]')) fail("Evaluate validation only, or validation and test for a final selection.");
  const testSelection = splits.includes("test") ? "final" : "not_evaluated";
  if (payload.test_selection !== testSelection) fail("Test evaluation must be explicitly tagged as a final selection.");
  if (!Array.isArray(payload.predictions) || !payload.predictions.length || payload.predictions.length > MAX_PREDICTIONS) fail("Submission requires 1–5,000 prediction rows.");
  const bySplit = new Map<Split, Map<string, number>>((splits as Split[]).map((split) => [split, new Map()]));
  for (const item of payload.predictions) {
    const row = object(item, "Prediction row"); exactFields(row, ["split", "record_id", "signal_score"], "Prediction row");
    const split = row.split as Split; const identifier = row.record_id;
    if (typeof split !== "string" || !bySplit.has(split) || typeof identifier !== "string" || !truth.splits[split].has(identifier)) fail("Prediction row has an unexpected split or record_id.");
    const score = number(row.signal_score, "signal_score"); const scores = bySplit.get(split)!;
    if (score > 1 || scores.has(identifier)) fail("Prediction scores must lie in [0, 1]; duplicate IDs are forbidden.");
    scores.set(identifier, score);
  }
  const metrics: Partial<Record<Split, Metrics>> = {};
  for (const [split, scores] of bySplit) {
    if (scores.size !== truth.splits[split].size) fail(`Predictions do not cover the complete fixed ${split} IDs.`);
    const identifiers = [...scores.keys()].sort();
    metrics[split] = classificationMetrics(identifiers.map((id) => truth.splits[split].get(id)!), identifiers.map((id) => scores.get(id)!));
  }
  const rawTimings = payload.timings as JsonObject;
  const training = number(rawTimings.training_seconds, "training_seconds");
  const inference = number(rawTimings.inference_seconds, "inference_seconds", true);
  const reference = number(rawTimings.reference_seconds, "reference_seconds", true);
  const protocol = payload.latency_protocol as JsonObject;
  const required: JsonObject = { id: "jetclass2-cpu-128-v1", warmups: 1, repeats: 3, threads: 1, reference_iterations: 64, benchmark_rows: 128, reference_kernel: REFERENCE_KERNEL, includes_feature_matrix_or_tensor_conversion: true, includes_model_loading: false };
  if (Object.entries(required).some(([key, value]) => protocol[key] !== value)) fail("Latency measurements must use the fixed workshop protocol.");
  if (protocol.batch_strategy !== (model === "sophon" ? "one jet per ONNX call" : "one batch of 128 jets")) fail("Latency batch strategy differs from the selected model's fixed protocol.");
  if (protocol.validation_ids_sha256 !== truth.validation_ids_sha256) fail("Latency benchmark does not identify the fixed 128 validation rows.");
  if (rawTimings.benchmark_rows !== 128 || rawTimings.repeat_count !== 3) fail("Latency benchmark requires 128 validation rows and three measured repeats.");
  const normalizedTime = (inference / 128) / (reference / 64);
  const perJet = inference / 128 * 1_000; const relativeSpeed = reference / inference;
  if (![normalizedTime, perJet, relativeSpeed].every((value) => Number.isFinite(value) && value > 0)) fail("Timing values are outside the supported numeric range.");
  return { experiment_id: experimentId, run_id: runId, model, feature_set: featureSet,
    feature_names: names as string[], parameters: parameters as Record<string, number>, seed: payload.seed,
    explanation, timestamp, updated_at: now, test_selection: testSelection, metrics,
    timings: { training_seconds: training, inference_seconds: inference, reference_seconds: reference, benchmark_rows: 128, repeat_count: 3, per_jet_ms: perJet, relative_speed: relativeSpeed, normalized_inference_time: normalizedTime },
    reported_metrics_match: metricsMatch(payload.metrics, metrics), metrics_recomputed: true, self_reported: true };
}

export function buildAwards(entries: LeaderboardEntry[]): Awards {
  const references = entries.filter((entry) => entry.model === "sophon");
  const finals = entries.filter((entry) => entry.test_selection === "final" && entry.model !== "sophon" && typeof entry.metrics.test?.roc_auc === "number");
  const best = finals.length ? Math.max(...finals.map((entry) => entry.metrics.test!.roc_auc!)) : null;
  const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  const byName = (a: LeaderboardEntry, b: LeaderboardEntry) => compareText(a.participant.displayName, b.participant.displayName) || compareText(a.participant.id, b.participant.id) || compareText(a.run_id, b.run_id);
  const bestPerParticipant = (rows: LeaderboardEntry[]): RankedEntry[] => {
    const seen = new Set<string>(); const selected: RankedEntry[] = [];
    for (const row of rows) {
      const key = row.participant.id; if (seen.has(key)) continue; seen.add(key);
      selected.push({ ...row, rank: selected.length + 1, test_auc: row.metrics.test!.roc_auc!, normalized_inference_time: row.timings.normalized_inference_time });
    }
    return selected;
  };
  return {
    quality: bestPerParticipant([...finals].sort((a, b) => b.metrics.test!.roc_auc! - a.metrics.test!.roc_auc! || byName(a, b))),
    efficiency: bestPerParticipant(finals.filter((entry) => best !== null && entry.metrics.test!.roc_auc! >= best - QUALITY_MARGIN - 1e-12).sort((a, b) => a.timings.normalized_inference_time - b.timings.normalized_inference_time || b.metrics.test!.roc_auc! - a.metrics.test!.roc_auc! || byName(a, b))),
    references, best_test_auc: best, quality_margin: QUALITY_MARGIN,
    rules: "Participant awards compare trained models only. Sophon is a frozen reference. Efficiency requires test AUC within 0.02 of the best trained final result; lower normalized time wins.",
    timing_caveat: "Scores and timings are participant-reported. Quality is recomputed against fixed labels; models are not rerun. The CPU reference is an approximate hardware adjustment, not a certified cross-device benchmark.",
  };
}
