"""Reproducibility, split integrity and local experiment lifecycle checks."""

import hashlib
import json
from pathlib import Path
import shutil

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
import pytest
import yaml

from common import sha256
from predict import benchmark, experiment
from predict.config import read_config
from predict.data import FEATURE_SOURCE_PATH, load_prepared
from predict.models import load_model
from predict.logistic import LogisticPredictor
from preprocessing.features import FEATURE_NAMES


@pytest.fixture
def prepared(tmp_path):
    directory = tmp_path / "prepared"
    directory.mkdir()
    manifest = {"dataset_id": "synthetic-contract-fixture", "feature_source_sha256": sha256(FEATURE_SOURCE_PATH), "splits": {}}
    for split, size in (("train", 40), ("validation", 128), ("test", 40)):
        rows = []
        for index in range(size):
            row = {name: float(index + 1) for name in FEATURE_NAMES}
            row.update(record_id=f"{split}-{index:04d}", split=split, truth_label=0 if index % 2 else 187,
                       truth_group="signal" if index % 2 else "background", jet_sdmass=100. if index % 2 else 10.)
            rows.append(row)
        path = directory / f"{split}.parquet"
        pq.write_table(pa.Table.from_pylist(rows), path)
        manifest["splits"][split] = {"file": path.name, "rows": size, "sha256": sha256(path)}
    (directory / "manifest.json").write_text(json.dumps(manifest))
    return directory


def config(tmp_path, **overrides):
    value = {"team": "Unit fixture", "explanation": "Synthetic test only", "experiments": [
        {"id": "logistic-basic", "model": "logistic", "features": "basic"}], **overrides}
    path = tmp_path / "experiments.yaml"
    path.write_text(yaml.safe_dump(value))
    return path


def test_prepared_data_is_bound_to_bytes_feature_code_and_disjoint_ids(prepared):
    manifest, splits = load_prepared(prepared)
    assert len(splits["validation"]) == 128
    rows = splits["validation"]
    rows[0]["record_id"] = splits["train"][0]["record_id"]
    pq.write_table(pa.Table.from_pylist(rows), prepared / "validation.parquet")
    with pytest.raises(ValueError, match="checksum"):
        load_prepared(prepared)
    manifest["splits"]["validation"]["sha256"] = sha256(prepared / "validation.parquet")
    (prepared / "manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="disjoint"):
        load_prepared(prepared)
    manifest["feature_source_sha256"] = "0" * 64
    (prepared / "manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="features.py changed"):
        load_prepared(prepared)


@pytest.mark.parametrize("overrides", [{"max_workers": 3}, {"max_workers": True}, {"evaluation": "train"},
    {"experiments": [{"id": "leak", "model": "logistic", "features": ["truth_label"]}]},
    {"experiments": [{"id": "bad", "model": "sophon", "features": "shape"}]}])
def test_config_rejects_unbounded_or_leaking_experiments(tmp_path, overrides):
    with pytest.raises(ValueError):
        read_config(config(tmp_path, **overrides))


@pytest.mark.parametrize("overrides", [{"team": "x" * 129}, {"explanation": ""}, {"explanation": "x" * 2001},
    {"experiments": [{"id": "linear", "model": "logistic", "features": "basic", "explanation": "  "}]},
    {"experiments": [{"id": "linear", "model": "logistic", "features": "basic", "explanation": "x" * 2001}]}])
def test_submission_metadata_is_validated_before_training(tmp_path, overrides):
    with pytest.raises(ValueError, match="team|explanation"):
        read_config(config(tmp_path, **overrides))


def test_entry_explanation_can_replace_omitted_top_level_note(tmp_path):
    path = config(tmp_path, explanation="", experiments=[{
        "id": "linear", "model": "logistic", "features": "basic", "explanation": "Test the simple feature set."}])
    assert read_config(path)["experiments"][0]["explanation"] == "Test the simple feature set."


def test_omitting_features_uses_the_three_baseline_measurements(tmp_path):
    path = config(tmp_path, experiments=[{"id": "minimal", "model": "logistic"}])
    assert read_config(path)["experiments"][0]["feature_names"] == ["jet_pt", "jet_sdmass", "particle_count"]


def test_registered_classifier_with_explicit_features_runs_and_reloads(prepared, tmp_path, monkeypatch):
    from predict.models import PREDICTORS

    # Reuse known model math to test adding a classifier without a second config
    # allowlist, with the same fit/save/reload and leakage rules as built-ins.
    class ParticipantClassifier(LogisticPredictor):
        kind = "participant-classifier"

        @classmethod
        def train(cls, rows, feature_names, params, directory, seed):
            expected = {*feature_names, "truth_label", "split"}
            assert all(set(row) == expected for row in rows)
            return super().train(rows, feature_names, params, directory, seed)

        def _predict(self, rows):
            assert all(set(row) == set(self.metadata["feature_names"]) for row in rows)
            return super()._predict(rows)

    monkeypatch.setitem(PREDICTORS, ParticipantClassifier.kind, ParticipantClassifier)
    selected = ["jet_sdmass", "energy_sum"]
    path = config(tmp_path, experiments=[{"id": "participant-experiment", "model": ParticipantClassifier.kind,
                                         "features": selected, "params": {"C": .5}}])
    parsed = read_config(path)["experiments"][0]
    assert parsed["feature_names"] == selected and parsed["feature_set"] == "custom"
    results_dir, models_dir = tmp_path / "results", tmp_path / "models"
    result = experiment.run_experiments(path, prepared, results_dir, "registered", models_dir)[0]
    assert result["model"] == ParticipantClassifier.kind and result["trained"] is True
    assert result["evaluated_splits"] == ["validation"]
    model = load_model(models_dir / result["run_id"])
    assert isinstance(model, ParticipantClassifier)
    _, rows = load_prepared(prepared)
    expected_scores = pq.read_table(results_dir / result["run_id"] / "predictions.parquet")["signal_score"].to_numpy()
    changed = [{**row, "truth_label": 999, "record_id": "changed", "split": "test"} for row in rows["validation"]]
    np.testing.assert_array_equal(model.predict(changed), expected_scores)
    assert not list((models_dir / result["run_id"]).glob("*.pkl"))


def test_unregistered_model_fails_with_extension_location(tmp_path):
    path = config(tmp_path, experiments=[{"id": "new", "model": "not-registered", "features": "basic"}])
    with pytest.raises(ValueError, match="registered model.*predict/models.py"):
        read_config(path)


@pytest.mark.parametrize("model,message", [
    ("xgboost", "XGBoost is installed in Docker; implement and register"),
    ("sophon", "Install the optional Sophon reference pack"),
])
def test_unavailable_model_explains_the_next_action(tmp_path, monkeypatch, model, message):
    from predict.models import PREDICTORS

    monkeypatch.delitem(PREDICTORS, model, raising=False)
    path = config(tmp_path, experiments=[{"id": "choice", "model": model, "features": "basic"}])
    with pytest.raises(ValueError, match=message):
        read_config(path)


def test_overlong_combined_run_id_is_rejected_before_loading_data_or_creating_results(tmp_path, monkeypatch):
    path = config(tmp_path, experiments=[{"id": "e" * 40, "model": "logistic", "features": "basic"}])
    monkeypatch.setattr(experiment, "load_prepared", lambda _: pytest.fail("Invalid identity must fail before loading data"))
    results = tmp_path / "results"
    with pytest.raises(ValueError, match="80 characters"):
        experiment.run_experiments(path, tmp_path / "missing", results, "p" * 60, tmp_path / "models")
    assert not results.exists()


def test_final_test_requires_one_preselected_experiment(tmp_path):
    choices = [{"id": name, "model": "logistic", "features": "basic"} for name in ("first", "second")]
    assert len(read_config(config(tmp_path, experiments=choices))["experiments"]) == 2
    with pytest.raises(ValueError, match="exactly one experiment"):
        read_config(config(tmp_path, evaluation="test", experiments=choices))


def test_validation_only_then_final_test_artifacts_are_immutable(prepared, tmp_path):
    path = config(tmp_path)
    results_dir, models_dir = tmp_path / "data/03_predictions", tmp_path / "models"
    first = experiment.run_experiments(path, prepared, results_dir, "validation", models_dir)[0]
    assert first["evaluated_splits"] == ["validation"]
    assert first["test_selection"] == "not_evaluated"
    predictions = pq.read_table(results_dir / first["run_id"] / "predictions.parquet")
    assert set(predictions["split"].to_pylist()) == {"validation"}
    assert first["latency_protocol"]["benchmark_rows"] == 128
    assert first["timings"]["relative_speed"] == pytest.approx(first["timings"]["reference_seconds"] / first["timings"]["inference_seconds"])
    ids = sorted(predictions["record_id"].to_pylist())
    assert first["latency_protocol"]["validation_ids_sha256"] == hashlib.sha256(("\n".join(ids) + "\n").encode()).hexdigest()
    prediction_directory = results_dir / first["run_id"]
    assert {item.name for item in prediction_directory.iterdir()} == {"result.json", "predictions.parquet"}
    assert first["model_artifact"]["path"] == f"../../../models/{first['run_id']}/manifest.json"
    model_manifest = (prediction_directory / first["model_artifact"]["path"]).resolve()
    assert model_manifest == models_dir / first["run_id"] / "manifest.json"
    assert sha256(model_manifest) == first["model_artifact"]["sha256"]
    rows = pq.read_table(prepared / "validation.parquet").to_pylist()
    np.testing.assert_array_equal(load_model(model_manifest.parent).predict(rows), predictions["signal_score"].to_numpy())
    with pytest.raises(ValueError, match="immutable"):
        experiment.run_experiments(path, prepared, results_dir, "validation", models_dir)
    final = experiment.run_experiments(config(tmp_path, evaluation="test"), prepared, results_dir, "final", models_dir)[0]
    assert final["evaluated_splits"] == ["validation", "test"]
    assert final["test_selection"] == "final"
    assert set(final["metrics"]) == {"validation", "test"}


def test_parallel_fit_finishes_before_any_latency_measurement(prepared, tmp_path, monkeypatch):
    state = {"pool_closed": False, "fitted": 0}

    class ImmediateFuture:
        def __init__(self, function, args):
            self.value = function(*args)
            state["fitted"] += 1
        def result(self):
            return self.value

    class Pool:
        def __init__(self, *, max_workers, mp_context):
            assert max_workers == 2
        def __enter__(self):
            return self
        def submit(self, function, *args):
            return ImmediateFuture(function, args)
        def __exit__(self, *_):
            state["pool_closed"] = True

    original = experiment.benchmark_model
    def benchmark_after_fits(model, validation):
        assert state == {"pool_closed": True, "fitted": 2}
        return original(model, validation)
    monkeypatch.setattr(experiment, "ProcessPoolExecutor", Pool)
    monkeypatch.setattr(experiment, "benchmark_model", benchmark_after_fits)
    path = config(tmp_path, max_workers=2, experiments=[{"id": name, "model": "logistic", "features": "basic"}
                                                     for name in ("first", "second")])
    assert len(experiment.run_experiments(path, prepared, tmp_path / "predictions", "parallel", tmp_path / "models")) == 2


def test_training_failure_records_all_incomplete_experiments(prepared, tmp_path, monkeypatch):
    def fail_training(*_):
        raise RuntimeError("Training failed")

    monkeypatch.setattr(experiment, "train_model", fail_training)
    path = config(tmp_path, experiments=[
        {"id": name, "model": "logistic", "features": "basic"} for name in ("first", "second")
    ])
    results = tmp_path / "predictions"
    with pytest.raises(RuntimeError, match="Training failed"):
        experiment.run_experiments(path, prepared, results, "failed", tmp_path / "models")
    for name in ("first", "second"):
        directory = results / f"failed-{name}"
        result = json.loads((directory / "result.json").read_text())
        assert result["status"] == "failed"
        assert result["error"] == {"type": "RuntimeError", "message": "Training failed"}
        assert not (directory / "predictions.parquet").exists()


@pytest.mark.parametrize("collision_side", ["predictions", "models"])
def test_all_output_collisions_fail_before_loading_or_creating_any_other_directory(tmp_path, monkeypatch, collision_side):
    path = config(tmp_path, experiments=[{"id": name, "model": "logistic", "features": "basic"}
                                        for name in ("first", "second")])
    prediction_root, model_root = tmp_path / "predictions", tmp_path / "models"
    existing = (prediction_root if collision_side == "predictions" else model_root) / "collision-second"
    existing.mkdir(parents=True)
    (existing / "preserve.txt").write_text("original")
    monkeypatch.setattr(experiment, "load_prepared", lambda _: pytest.fail("Collision must fail before data loading"))
    with pytest.raises(ValueError, match="already exists"):
        experiment.run_experiments(path, tmp_path / "missing", prediction_root, "collision", model_root)
    assert (existing / "preserve.txt").read_text() == "original"
    assert not (prediction_root / "collision-first").exists()
    assert not (model_root / "collision-first").exists()
    other = (model_root if collision_side == "predictions" else prediction_root) / "collision-second"
    assert not other.exists()


def test_prediction_and_model_directories_cannot_overlap(tmp_path, monkeypatch):
    path = config(tmp_path)
    destination = tmp_path / "shared"
    monkeypatch.setattr(experiment, "load_prepared", lambda _: pytest.fail("Overlap must fail before data loading"))
    with pytest.raises(ValueError, match="must be separate"):
        experiment.run_experiments(path, tmp_path / "missing", destination, "overlap", destination)
    assert not destination.exists()


def test_custom_model_path_remains_usable_after_moving_the_whole_workshop(prepared, tmp_path):
    workspace = tmp_path / "Workspace With Spaces"
    prediction_root, model_root = workspace / "outputs/predictions", workspace / "saved models"
    result = experiment.run_experiments(config(tmp_path), prepared, prediction_root, "portable", model_root)[0]
    assert not Path(result["model_artifact"]["path"]).is_absolute()
    assert "\\" not in result["model_artifact"]["path"]
    moved = tmp_path / "Moved Workshop"
    shutil.move(str(workspace), moved)
    prediction_dir = moved / "outputs/predictions" / result["run_id"]
    manifest_path = (prediction_dir / result["model_artifact"]["path"]).resolve()
    assert manifest_path.is_file()
    rows = pq.read_table(prepared / "validation.parquet").to_pylist()
    actual = load_model(manifest_path.parent).predict(rows)
    expected = pq.read_table(prediction_dir / "predictions.parquet")["signal_score"].to_numpy()
    np.testing.assert_array_equal(actual, expected)


def test_hardware_memory_measurements_are_integer_cgroup_values(monkeypatch):
    values = {"/sys/fs/cgroup/cpu.max": "200000 100000\n", "/sys/fs/cgroup/memory.max": "2147483648\n",
              "/sys/fs/cgroup/memory.peak": "359874560\n",
              "/sys/fs/cgroup/memory.events": "high 0\nmax 0\noom 0\noom_kill 0\n"}

    class CgroupPath:
        def __init__(self, path):
            self.path = str(path)
        def __truediv__(self, child):
            return CgroupPath(self.path + "/" + child)
        def is_file(self):
            return self.path in values
        def read_text(self):
            return values[self.path]

    monkeypatch.setattr(benchmark, "Path", CgroupPath)
    hardware = benchmark.hardware_info()
    assert hardware["memory_peak_bytes"] == 359874560
    assert hardware["memory_events"] == {"high": 0, "max": 0, "oom": 0, "oom_kill": 0}
    assert all(type(value) is int for value in hardware["memory_events"].values())
