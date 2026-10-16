"""Synthetic predictions test score validation and the two explicit ranking rules."""

import copy
import hashlib
import json

import pytest

from postprocessing.leaderboard import FIELDS, REFERENCE_KERNEL, classification_metrics, leaderboard, make_submission, read_json, validate_submission


def sample_submission(final=True):
    truth = {split: {f"{split}-{index:03d}": index % 2 for index in range(128)}
             for split in ("validation", "test")}
    splits = ["validation", "test"] if final else ["validation"]
    identifiers = sorted(truth["validation"])
    payload = {"version": 1, "dataset_id": "d" * 64, "experiment_id": "logistic-shape",
        "run_id": "demo-logistic-shape", "team": "Team A", "model": "logistic",
        "feature_names": ["jet_pt", "jet_sdmass"], "feature_set": "custom", "parameters": {"C": 1.0},
        "seed": 42, "feature_source_sha256": "f" * 64, "decision_threshold": 0.5,
        "evaluated_splits": splits, "test_selection": "final" if final else "not_evaluated",
        "metrics": {}, "timings": {"training_seconds": 1.0, "inference_seconds": .02,
            "reference_seconds": .1, "benchmark_rows": 128, "repeat_count": 3},
        "latency_protocol": {"id": "jetclass2-cpu-128-v1", "warmups": 1, "repeats": 3,
            "threads": 1, "reference_iterations": 64, "benchmark_rows": 128,
            "validation_ids_sha256": hashlib.sha256(("\n".join(identifiers) + "\n").encode()).hexdigest(),
            "reference_kernel": REFERENCE_KERNEL, "includes_feature_matrix_or_tensor_conversion": True,
            "includes_model_loading": False, "batch_strategy": "one batch of 128 jets"}, "hardware": {"architecture": "synthetic-test"},
        "explanation": "Synthetic unit test; these are not real model predictions.",
        "timestamp": "2026-10-12T12:00:00+00:00",
        "predictions": [{"split": split, "record_id": key, "signal_score": .9 if label else .1}
                        for split in splits for key, label in truth[split].items()]}
    return payload, truth


def test_metrics_are_recomputed_and_bad_reported_claim_is_flagged():
    payload, truth = sample_submission()
    payload["metrics"] = {"test": {"roc_auc": 0.123}}
    result = validate_submission(payload, payload["dataset_id"], truth)
    assert result["metrics"]["test"]["roc_auc"] == 1.0
    assert result["metrics"]["test"]["confusion"] == {"tn": 64, "fp": 0, "fn": 0, "tp": 64}
    assert result["reported_metrics_match"] is False
    assert result["timings"]["normalized_inference_time"] == pytest.approx(.1)
    assert result["timings"]["relative_speed"] == pytest.approx(5)


def test_custom_classifier_features_and_parameter_metadata_can_be_published():
    payload, truth = sample_submission()
    payload.update(model="random_forest", trained=True, feature_names=["energy_ratio", "jet_pt"],
                   parameters={"bootstrap": True, "criterion": "gini", "max_features": None, "offset": -1,
                               "objective": "binary:logistic", "eval_metric": "error@0.5",
                               "hidden_layer_sizes": [32, 16], "interaction_constraints": [[0, 1], [2]]})
    checked = validate_submission(payload, payload["dataset_id"], truth)
    assert checked["trained"] is True
    assert checked["parameters"] == payload["parameters"]
    assert checked["feature_names"] == payload["feature_names"]
    exported = make_submission(checked, payload["predictions"])
    assert set(exported) == FIELDS and exported["trained"] is True
    assert leaderboard([checked])["quality"][0]["trained"] is True


def test_legacy_results_are_normalized_without_mutating_the_input():
    payload, truth = sample_submission()
    for model in ("logistic", "xgboost", "sophon"):
        payload["model"] = model
        if model == "sophon":
            payload["parameters"] = {"batch_size": 1, "threads": 1}
            payload["latency_protocol"]["batch_strategy"] = "one jet per ONNX call"
        checked = validate_submission(payload, payload["dataset_id"], truth)
        assert checked["trained"] is (model != "sophon")
        assert make_submission(payload, payload["predictions"])["trained"] is (model != "sophon")
        assert "trained" not in payload


@pytest.mark.parametrize("change", [
    {"model": "random_forest"}, {"trained": 1}, {"trained": "true"},
    {"model": "../classifier", "trained": True}, {"model": "x" * 65, "trained": True},
    {"parameters": {"criterion": "run()"}}, {"parameters": {"weights": [1] * 33}},
    {"parameters": {"weights": [[[1]]]}}, {"parameters": {"weights": [float("inf")]}},
    {"parameters": {"weights": ["../private"]}}, {"parameters": {"weights": [{"x": 1}]}},
    {"parameters": {"settings": {"depth": 3}}}, {"parameters": {"criterion": "x" * 65}},
    {"parameters": {"model_dir": "models"}}, {"parameters": {"code": "run"}},
])
def test_extended_metadata_remains_bounded_and_explicit(change):
    payload, truth = sample_submission()
    payload.update(change)
    with pytest.raises(ValueError):
        validate_submission(payload, payload["dataset_id"], truth)


def test_all_frozen_models_stay_outside_training_awards():
    payload, truth = sample_submission()
    trained = validate_submission(payload, payload["dataset_id"], truth)
    trained["metrics"]["test"]["roc_auc"] = .85
    frozen = copy.deepcopy(trained)
    frozen.update(model="frozen_reference", trained=False, team="Reference")
    frozen["metrics"]["test"]["roc_auc"] = 1.0
    legacy_unknown = {key: value for key, value in frozen.items() if key != "trained"}
    for reference in (frozen, legacy_unknown):
        ranks = leaderboard([trained, reference])
        assert ranks["best_test_auc"] == .85
        assert len(ranks["quality"]) == len(ranks["efficiency"]) == 1
        assert ranks["references"][0]["trained"] is False
    payload.update(model="sophon", trained=True, parameters={"batch_size": 1, "threads": 1})
    payload["latency_protocol"]["batch_strategy"] = "one jet per ONNX call"
    assert validate_submission(payload, payload["dataset_id"], truth)["trained"] is False


@pytest.mark.parametrize("damage", ["duplicate", "missing", "foreign", "train", "nan", "range", "bool", "extra", "dataset", "protocol", "benchmark_ids", "time", "leak", "untagged", "split_object", "model_object", "param_path"])
def test_invalid_scores_metadata_or_protocol_are_rejected(damage):
    payload, truth = sample_submission()
    if damage == "duplicate":
        payload["predictions"].append(dict(payload["predictions"][0]))
    elif damage == "missing":
        payload["predictions"].pop()
    elif damage == "foreign":
        payload["predictions"][0]["record_id"] = "unknown"
    elif damage == "train":
        payload["predictions"][0]["split"] = "train"
    elif damage in {"nan", "range", "bool"}:
        payload["predictions"][0]["signal_score"] = {"nan": float("nan"), "range": 1.1, "bool": True}[damage]
    elif damage == "extra":
        payload["model_path"] = "/tmp/untrusted-model.pkl"
    elif damage == "dataset":
        payload["dataset_id"] = "foreign"
    elif damage == "protocol":
        payload["latency_protocol"]["threads"] = 8
    elif damage == "benchmark_ids":
        payload["latency_protocol"]["validation_ids_sha256"] = "a" * 64
    elif damage == "time":
        payload["timings"]["reference_seconds"] = 0
    elif damage == "leak":
        payload["feature_names"] = ["truth_label"]
    elif damage == "split_object":
        payload["predictions"][0]["split"] = {}
    elif damage == "model_object":
        payload["model"] = {}
    elif damage == "param_path":
        payload["parameters"]["model_dir"] = "/tmp/untrusted"
    else:
        payload["test_selection"] = "not_evaluated"
    with pytest.raises(ValueError):
        validate_submission(payload, "d" * 64, truth)


def test_quality_and_efficiency_rankings_are_separate_and_one_entry_per_team():
    payload, truth = sample_submission()
    template = validate_submission(payload, payload["dataset_id"], truth)
    experiments = []
    for team, run, auc, normalized in [
        ("A", "a", .95, 3), ("B", "b", .94, 1), ("C", "c", .929, .1), ("B", "b2", .935, .5),
    ]:
        row = copy.deepcopy(template)
        row.update(team=team, run_id=run, experiment_id=run)
        row["metrics"]["test"]["roc_auc"] = auc
        row["timings"]["normalized_inference_time"] = normalized
        experiments.append(row)
    ranks = leaderboard(experiments)
    assert [row["team"] for row in ranks["quality"]] == ["A", "B", "C"]
    assert [row["team"] for row in ranks["efficiency"]] == ["B", "A"]
    assert ranks["efficiency"][0]["run_id"] == "b2"
    assert ranks["best_test_auc"] == .95


def test_validation_only_experiments_never_enter_final_leaderboard():
    payload, truth = sample_submission(final=False)
    row = validate_submission(payload, payload["dataset_id"], truth)
    assert leaderboard([row])["quality"] == []
    assert leaderboard([row])["best_test_auc"] is None


def test_frozen_sophon_is_visible_but_does_not_set_the_trained_model_quality_floor():
    payload, truth = sample_submission()
    trained = validate_submission(payload, payload["dataset_id"], truth)
    trained["metrics"]["test"]["roc_auc"] = .85
    reference = copy.deepcopy(trained)
    reference.update(model="sophon", team="Reference", run_id="sophon", experiment_id="sophon")
    reference["metrics"]["test"]["roc_auc"] = .999
    ranks = leaderboard([reference, trained])
    assert ranks["best_test_auc"] == .85
    assert [row["team"] for row in ranks["quality"]] == ["Team A"]
    assert [row["team"] for row in ranks["efficiency"]] == ["Team A"]
    assert ranks["references"][0]["model"] == "sophon"
    assert leaderboard([reference])["quality"] == []


@pytest.mark.parametrize("scores", [[.9, .1, .8, .2], [.5, .5, .5, .5], [.5, .5, .2, .9], [.1, .9, .2, .8]])
def test_independent_metric_reference_matches_model_library_including_ties(scores):
    from predict.metrics import classification_metrics as model_metrics
    labels = [1, 0, 1, 0]
    actual, expected = classification_metrics(labels, scores), model_metrics(labels, scores)
    assert actual.pop("confusion") == expected.pop("confusion")
    assert actual == pytest.approx(expected)


def test_json_reader_rejects_duplicate_keys_oversize_and_symlinks(tmp_path):
    path = tmp_path / "submission.json"
    path.write_text('{"team":"A","team":"B"}')
    with pytest.raises(ValueError, match="Duplicate JSON key"):
        read_json(path)
    path.write_text(json.dumps({"content": "x" * 100}))
    with pytest.raises(ValueError, match="exceeds"):
        read_json(path, max_bytes=20)
    link = tmp_path / "linked.json"
    link.symlink_to(path)
    with pytest.raises(ValueError, match="symlink"):
        read_json(link)
