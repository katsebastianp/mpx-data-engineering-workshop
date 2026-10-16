"""Validate one JSON per team and build a transparent, self-reported leaderboard."""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import math
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from common import ANALYTICS_DIR, CONFIG_DIR, SUBMISSIONS_DIR, write_json

MAX_BYTES = 2_000_000
MAX_PREDICTIONS = 5_000
QUALITY_MARGIN = 0.02
REFERENCE_KERNEL = "64 float64 256x256 matrix products; seed 42; one BLAS thread; median of 3 after 1 warmup"
FIELDS = {
    "version", "dataset_id", "experiment_id", "run_id", "team", "model", "feature_names",
    "feature_set", "parameters", "seed", "feature_source_sha256", "decision_threshold",
    "evaluated_splits", "test_selection", "metrics", "timings", "hardware", "explanation",
    "timestamp", "latency_protocol", "predictions", "trained",
}
LEGACY_FIELDS = FIELDS - {"trained"}


def classification_metrics(labels: list[int], scores: list[float], threshold: float = .5) -> dict:
    """Independent binary metric reference; ties receive equal ranks/precision steps."""
    if (not labels or len(labels) != len(scores) or isinstance(threshold, bool)
            or not isinstance(threshold, (int, float)) or not math.isfinite(threshold) or not 0 <= threshold <= 1
            or any(type(label) is not int or label not in (0, 1) for label in labels)
            or any(isinstance(score, bool) or not isinstance(score, (float, int)) or not math.isfinite(score)
                   or not 0 <= score <= 1 for score in scores)):
        raise ValueError("Metrics require aligned binary truth and finite scores in [0, 1].")
    positives, negatives = sum(labels), len(labels) - sum(labels)
    groups: dict[float, list[int]] = {}
    for label, score in zip(labels, scores):
        group = groups.setdefault(score, [0, 0])
        group[label] += 1
    rank_sum, below = 0.0, 0
    for score in sorted(groups):
        background, signal = groups[score]
        count = background + signal
        rank_sum += signal * (below + (count + 1) / 2)
        below += count
    auc = (rank_sum - positives * (positives + 1) / 2) / (positives * negatives) if positives and negatives else None
    selected_signal, selected_total, precision_terms = 0, 0, []
    for score in sorted(groups, reverse=True):
        background, signal = groups[score]
        selected_signal += signal
        selected_total += background + signal
        if positives:
            precision_terms.append(signal / positives * selected_signal / selected_total)
    tp = sum(label == 1 and score >= threshold for label, score in zip(labels, scores))
    fp = sum(label == 0 and score >= threshold for label, score in zip(labels, scores))
    fn, tn = positives - tp, negatives - fp
    return {"rows": len(labels), "signal_rows": positives, "background_rows": negatives,
            "roc_auc": auc, "average_precision": math.fsum(precision_terms) if positives else None,
            "accuracy": (tp + tn) / len(labels), "f1": 2 * tp / (2 * tp + fp + fn) if tp + fp + fn else 0.0,
            "confusion": {"tn": tn, "fp": fp, "fn": fn, "tp": tp},
            "signal_retention": tp / positives if positives else None,
            "background_rejection": tn / negatives if negatives else None}


def _unique_object(pairs: list[tuple[str, Any]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def read_json(path: Path, max_bytes: int = MAX_BYTES) -> dict:
    """Reject oversized or ambiguous JSON before trusting any fields."""
    if path.is_symlink():
        raise ValueError(f"Expected a regular JSON file, not a symlink: {path}")
    with path.open("rb") as stream:
        content = stream.read(max_bytes + 1)
    if len(content) > max_bytes:
        raise ValueError(f"JSON exceeds {max_bytes:,} bytes: {path}")
    result = json.loads(content, object_pairs_hook=_unique_object)
    if not isinstance(result, dict):
        raise ValueError(f"Expected a JSON object: {path}")
    _bounded_json(result)
    return result


def _bounded_json(value: Any, depth: int = 0) -> None:
    if depth > 8:
        raise ValueError("JSON nesting exceeds eight levels.")
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError("JSON numbers must be finite.")
    if isinstance(value, dict):
        if len(value) > 100:
            raise ValueError("JSON objects may contain at most 100 fields.")
        for key, child in value.items():
            if not isinstance(key, str) or len(key) > 128:
                raise ValueError("JSON field names must be short strings.")
            _bounded_json(child, depth + 1)
    elif isinstance(value, list):
        if len(value) > MAX_PREDICTIONS:
            raise ValueError("JSON arrays exceed the submission row limit.")
        for child in value:
            _bounded_json(child, depth + 1)
    elif isinstance(value, str) and len(value) > 2_000:
        raise ValueError("Submission text fields must be at most 2,000 characters.")


def _text(value: Any, name: str, maximum: int = 128) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ValueError(f"{name} must be a nonempty string of at most {maximum} characters.")
    return value


def _number(value: Any, name: str, *, positive: bool = False) -> float:
    if (isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)
            or value < 0 or (positive and value == 0)):
        raise ValueError(f"{name} must be a finite {'positive' if positive else 'nonnegative'} number.")
    return float(value)


def make_submission(result: dict, predictions: list[dict]) -> dict:
    """Copy only the public result contract; never include paths, models or code."""
    payload = {name: result[name] for name in LEGACY_FIELDS - {"predictions"}}
    payload["trained"] = _trained(result, require_explicit=True)
    payload["predictions"] = predictions
    if len(json.dumps(payload, allow_nan=False).encode()) > MAX_BYTES:
        raise ValueError("Submission exceeds the 2 MB limit.")
    return payload


def _trained(row: dict, *, require_explicit: bool = False) -> bool:
    """Legacy known models retain their status; unknown references never earn awards by default."""
    if "trained" in row and type(row["trained"]) is not bool:
        raise ValueError("trained must be a boolean.")
    if row["model"] == "sophon":
        return False
    if "trained" in row:
        return row["trained"]
    if row["model"] in {"logistic", "xgboost"}:
        return True
    if require_explicit:
        raise ValueError("New model identifiers require an explicit trained boolean.")
    return False


def _parameter_value(value: Any, depth: int = 0) -> bool:
    """Bounded display values, including objectives and small layer/constraint lists."""
    if isinstance(value, list):
        return depth < 2 and len(value) <= 32 and all(_parameter_value(item, depth + 1) for item in value)
    return (value is None or type(value) is bool
            or type(value) in (int, float) and math.isfinite(value)
            or isinstance(value, str) and re.fullmatch(r"[A-Za-z][A-Za-z0-9_.:@-]{0,63}", value) is not None)


def _validate_parameters(parameters: dict) -> None:
    """Only display metadata crosses this boundary; the local runtime validates supported settings."""
    for name, value in parameters.items():
        if (not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", name)
                or re.search(r"(?:^|_)(?:path|dir|directory|file|filename|code|script|command|url)(?:_|$)", name, re.I)
                or name in {"constructor", "prototype"}):
            raise ValueError("Submission parameters require setting names, not paths or code.")
        if _parameter_value(value):
            continue
        raise ValueError(f"parameter {name} must be finite numeric, boolean, null, a short enum, or a list "
                         "of these (32 items per list, two levels); no paths, objects or code.")


def submission_name(payload: dict) -> str:
    team = re.sub(r"[^a-z0-9]+", "-", payload["team"].lower()).strip("-") or "team"
    run = payload["run_id"]
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}", run):
        raise ValueError("run_id must be a safe filename identifier (1–80 letters, numbers, '-' or '_').")
    return f"{team[:60]}-{run}.json"


def _metrics_match(actual: Any, expected: Any) -> bool:
    if isinstance(expected, dict):
        return (isinstance(actual, dict) and set(actual) == set(expected)
                and all(_metrics_match(actual[key], value) for key, value in expected.items()))
    if isinstance(expected, (float, int)) and not isinstance(expected, bool):
        return (isinstance(actual, (float, int)) and not isinstance(actual, bool)
                and math.isclose(actual, expected, rel_tol=1e-7, abs_tol=1e-9))
    return actual == expected


def _validate_metadata(payload: dict, dataset_id: str) -> None:
    if type(payload["version"]) is not int or payload["version"] != 1:
        raise ValueError("Submission version must be 1.")
    if payload["dataset_id"] != dataset_id:
        raise ValueError("Submission belongs to a different dataset.")
    for key in ("experiment_id", "run_id", "team", "feature_set", "timestamp"):
        _text(payload[key], key)
    submission_name(payload)
    timestamp = datetime.fromisoformat(payload["timestamp"].replace("Z", "+00:00"))
    if timestamp.tzinfo is None:
        raise ValueError("Submission timestamp must include its timezone.")
    if not isinstance(payload["model"], str) or not re.fullmatch(r"[a-z][a-z0-9_-]{0,63}", payload["model"]):
        raise ValueError("model must be a lowercase identifier of at most 64 letters, numbers, '-' or '_'.")
    _trained(payload, require_explicit=True)
    names = payload["feature_names"]
    if (not isinstance(names, list) or not names or len(names) > 100
            or any(not isinstance(name, str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", name)
                   for name in names) or len(names) != len(set(names))):
        raise ValueError("feature_names must be a nonempty, unique list of column names.")
    if any(name in {"truth_label", "truth_group", "record_id", "source_file", "source_row", "split", "jet_label"}
           or name.startswith(("genpart_", "genjet_", "aux_genpart_")) for name in names):
        raise ValueError("Labels, identities and generator truth are not prediction features.")
    for key in ("parameters", "hardware", "latency_protocol", "timings", "metrics"):
        if not isinstance(payload[key], dict):
            raise ValueError(f"{key} must be an object.")
    _validate_parameters(payload["parameters"])
    if payload["model"] == "sophon" and (payload["parameters"] != {"batch_size": 1, "threads": 1}
            or any(type(value) not in (int, float) for value in payload["parameters"].values())):
        raise ValueError("Sophon is frozen and must use batch size 1 and one thread.")
    if type(payload["seed"]) is not int or not 0 <= payload["seed"] < 2**32:
        raise ValueError("seed must be an integer between 0 and 2^32−1.")
    if not re.fullmatch(r"[0-9a-f]{64}", str(payload["feature_source_sha256"])):
        raise ValueError("Missing feature source checksum.")
    _text(payload["explanation"], "explanation", 2_000)
    if type(payload["decision_threshold"]) not in (int, float) or payload["decision_threshold"] != 0.5:
        raise ValueError("This teaching protocol uses the fixed threshold 0.5.")
    splits = payload["evaluated_splits"]
    if splits not in (["validation"], ["validation", "test"]):
        raise ValueError("Evaluate validation only, or validation and test for a final selection.")
    if payload["test_selection"] != ("final" if "test" in splits else "not_evaluated"):
        raise ValueError("Test evaluation must be explicitly tagged as a final selection.")


def _prediction_metrics(payload: dict, truth: dict[str, dict[str, int]]) -> dict:
    splits = payload["evaluated_splits"]
    predictions = payload["predictions"]
    if not isinstance(predictions, list) or not 0 < len(predictions) <= MAX_PREDICTIONS:
        raise ValueError("Submission requires 1–5,000 prediction rows.")
    by_split: dict[str, dict[str, float]] = {split: {} for split in splits}
    for row in predictions:
        if not isinstance(row, dict) or set(row) != {"split", "record_id", "signal_score"}:
            raise ValueError("Prediction rows require exactly split, record_id and signal_score.")
        split, identifier = row["split"], row["record_id"]
        if not isinstance(split, str) or split not in by_split or not isinstance(identifier, str) or identifier not in truth[split]:
            raise ValueError("Prediction row has an unexpected split or record_id.")
        score = _number(row["signal_score"], "signal_score")
        if score > 1 or identifier in by_split[split]:
            raise ValueError("Prediction scores must lie in [0, 1]; duplicate IDs are forbidden.")
        by_split[split][identifier] = score
    metrics = {}
    for split, scores in by_split.items():
        if set(scores) != set(truth[split]):
            raise ValueError(f"Predictions do not cover the complete fixed {split} IDs.")
        identifiers = sorted(scores)
        metrics[split] = classification_metrics([truth[split][key] for key in identifiers],
                                                [scores[key] for key in identifiers], threshold=0.5)
    return metrics


def _validated_timings(payload: dict, truth: dict[str, dict[str, int]]) -> dict:
    timings = dict(payload["timings"])
    for name in ("training_seconds", "inference_seconds", "reference_seconds"):
        timings[name] = _number(timings.get(name), name, positive=name != "training_seconds")
    protocol = payload["latency_protocol"]
    required = {"id": "jetclass2-cpu-128-v1", "warmups": 1, "repeats": 3,
                "threads": 1, "reference_iterations": 64, "benchmark_rows": 128,
                "reference_kernel": REFERENCE_KERNEL, "includes_feature_matrix_or_tensor_conversion": True,
                "includes_model_loading": False}
    if any(type(protocol.get(key)) is not type(value) or protocol[key] != value for key, value in required.items()):
        raise ValueError("Latency measurements must use the fixed workshop protocol.")
    expected_batch = "one jet per ONNX call" if payload["model"] == "sophon" else "one batch of 128 jets"
    if protocol.get("batch_strategy") != expected_batch:
        raise ValueError("Latency batch strategy differs from the selected model's fixed protocol.")
    count = 128
    identifiers = sorted(truth["validation"])[:count]
    identity = hashlib.sha256(("\n".join(identifiers) + "\n").encode()).hexdigest()
    if len(identifiers) != count or protocol.get("validation_ids_sha256") != identity:
        raise ValueError("Latency benchmark does not identify the fixed 128 validation rows.")
    if type(timings.get("benchmark_rows")) is not int or timings["benchmark_rows"] != count:
        raise ValueError("Latency benchmark must use the fixed validation sample size.")
    if timings.get("repeat_count") != 3:
        raise ValueError("Latency benchmark requires three measured repeats.")
    timings.update(per_jet_ms=timings["inference_seconds"] / count * 1000,
                   relative_speed=timings["reference_seconds"] / timings["inference_seconds"],
                   normalized_inference_time=(timings["inference_seconds"] / count)
                       / (timings["reference_seconds"] / protocol["reference_iterations"]))
    return timings


def validate_submission(payload: dict, dataset_id: str,
                        truth: dict[str, dict[str, int]]) -> dict:
    """Recompute metrics from reference truth, preserving only validated metadata.

    Scores and timings remain team-reported. This checks their structure and
    evaluates the submitted scores; it does not authenticate model execution.
    """
    if set(payload) not in (FIELDS, LEGACY_FIELDS):
        raise ValueError(f"Unexpected submission fields: {sorted(set(payload) ^ FIELDS)}")
    _bounded_json(payload)
    _validate_metadata(payload, dataset_id)
    metrics = _prediction_metrics(payload, truth)
    timings = _validated_timings(payload, truth)
    experiment_key = hashlib.sha256(json.dumps([payload["team"], payload["run_id"]]).encode()).hexdigest()[:24]
    return {**payload, "trained": _trained(payload, require_explicit=True),
            "experiment_key": experiment_key, "metrics": metrics, "timings": timings,
            "reported_metrics_match": _metrics_match(payload["metrics"], metrics),
            "metrics_recomputed": True,
            "reporting": "Team-reported scores and timings; quality recomputed against fixed reference labels."}


def _leaderboard_entry(row: dict, rank: int) -> dict:
    return {
        "rank": rank,
        "team": row["team"],
        "experiment_id": row["experiment_id"],
        "run_id": row["run_id"],
        "model": row["model"],
        "trained": _trained(row),
        "feature_set": row["feature_set"],
        "test_auc": row["metrics"]["test"]["roc_auc"],
        "normalized_inference_time": row["timings"]["normalized_inference_time"],
        "training_seconds": row["timings"]["training_seconds"],
        "inference_seconds": row["timings"]["inference_seconds"],
        "reference_seconds": row["timings"]["reference_seconds"],
        "explanation": row["explanation"],
        "self_reported": True,
    }


def _best_per_team(rows: list[dict]) -> list[dict]:
    seen = set()
    selected = []
    for row in rows:
        if row["team"] not in seen:
            seen.add(row["team"])
            selected.append(_leaderboard_entry(row, len(selected) + 1))
    return selected


def leaderboard(experiments: list[dict]) -> dict:
    """Two separate rankings; no weighted composite or hidden hardware correction."""
    references = [{**{name: row[name] for name in ("team", "experiment_id", "run_id", "model", "metrics", "timings")},
                   "trained": False} for row in experiments if not _trained(row)]
    policy = {"references": references, "quality_margin": QUALITY_MARGIN,
              "rules": "Team awards compare trained models only. Frozen models stay visible as references. Efficiency requires AUC within 0.02 of the best trained final result; lower normalized time wins.",
              "timing_caveat": "Self-reported. The fixed CPU reference is only an approximate hardware adjustment, not a certified cross-device benchmark."}
    final = [row for row in experiments if row["test_selection"] == "final" and _trained(row)]
    if not final:
        return {"quality": [], "efficiency": [], "best_test_auc": None, **policy}
    best = max(row["metrics"]["test"]["roc_auc"] for row in final)

    quality = sorted(final, key=lambda row: (-row["metrics"]["test"]["roc_auc"], row["team"], row["run_id"]))
    eligible = [row for row in final if row["metrics"]["test"]["roc_auc"] >= best - QUALITY_MARGIN - 1e-12]
    efficiency = sorted(eligible, key=lambda row: (row["timings"]["normalized_inference_time"],
                                                  -row["metrics"]["test"]["roc_auc"], row["team"], row["run_id"]))
    return {"quality": _best_per_team(quality), "efficiency": _best_per_team(efficiency),
            "best_test_auc": best, **policy}


def load_evaluation(evaluation_path: Path) -> tuple[str, dict[str, dict[str, int]]]:
    """Load the facilitator's canonical evaluation identity and simulated truth."""
    reference = read_json(evaluation_path)
    if set(reference) != {"version", "dataset_id", "splits"} or reference["version"] != 1:
        raise ValueError("Expected the facilitator's version-1 canonical evaluation contract.")
    if set(reference["splits"]) != {"validation", "test"}:
        raise ValueError("Canonical evaluation must contain validation and test truth.")
    truth, seen = {}, set()
    for split, rows in reference["splits"].items():
        truth[split] = {}
        for row in rows:
            if (not isinstance(row, dict) or set(row) != {"record_id", "label"}
                    or not isinstance(row["record_id"], str) or row["record_id"] in seen
                    or type(row["label"]) is not int or row["label"] not in (0, 1)):
                raise ValueError("Canonical evaluation IDs and binary labels must be valid and disjoint.")
            seen.add(row["record_id"])
            truth[split][row["record_id"]] = row["label"]
        if set(truth[split].values()) != {0, 1}:
            raise ValueError("Each canonical evaluation split requires both truth groups.")
    return reference["dataset_id"], truth


def build_leaderboard(evaluation_path: Path, submissions_dir: Path, output_path: Path) -> dict:
    """Validate team JSON against the maintainer's fixed evaluation data; no models run."""
    dataset_id, truth = load_evaluation(evaluation_path)
    experiments, keys = [], set()
    for path in sorted(submissions_dir.glob("*.json")):
        experiment = validate_submission(read_json(path), dataset_id, truth)
        if experiment["test_selection"] != "final":
            raise ValueError(f"Only final selections belong in shared submissions: {path.name}")
        if experiment["experiment_key"] in keys:
            raise ValueError("Duplicate team/run submission; keep only one copy.")
        keys.add(experiment["experiment_key"])
        experiments.append(experiment)
    result = {"version": 1, "dataset_id": dataset_id, "submission_count": len(experiments),
              "experiments": [{key: value for key, value in row.items() if key != "predictions"} for row in experiments],
              "leaderboard": leaderboard(experiments)}
    write_json(output_path, result)
    return result


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evaluation", type=Path, default=CONFIG_DIR / "evaluation.json")
    parser.add_argument("--submissions", type=Path, default=SUBMISSIONS_DIR)
    parser.add_argument("--output", type=Path, default=ANALYTICS_DIR / "leaderboard.json")
    args = parser.parse_args(argv)
    try:
        result = build_leaderboard(args.evaluation, args.submissions, args.output)
        print(json.dumps({"submissions": result["submission_count"], "output": str(args.output)}))
        return 0
    except Exception:
        logging.exception("Submission validation failed; no model or submitted code was executed")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
