"""Real DuckDB persistence, portable exports and comparison integrity checks."""

import copy
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from postprocessing.compare import compare, load_prepared
from postprocessing.database import AnalyticsStore
from postprocessing.leaderboard import validate_submission
from test_competition import sample_submission


def test_bundled_preview_cannot_reveal_final_test_results_before_model_selection():
    directory = Path(__file__).resolve().parents[1] / "tools/model-explorer"
    comparison = json.loads((directory / "comparison.json").read_text())
    board = json.loads((directory / "leaderboard.json").read_text())
    assert len(comparison["experiments"]) == 2
    for experiment in comparison["experiments"]:
        assert experiment["evaluated_splits"] == ["validation"]
        assert set(experiment["metrics"]) == {"validation"}
        assert experiment["test_selection"] == "not_evaluated"
    for field in ("jets", "population", "predictions"):
        assert comparison[field] and {row["split"] for row in comparison[field]} == {"validation"}
    assert comparison["submission_files"] == []
    assert board["dataset_id"] == comparison["dataset_id"]
    assert board["experiments"] == [] and board["submission_count"] == 0
    assert board["leaderboard"] == comparison["leaderboard"] == {"quality": [], "efficiency": []}


@pytest.fixture
def comparison_files(tmp_path):
    prepared, results, submissions, analytics = (tmp_path / name for name in (
        "02_preprocessed", "03_predictions", "04_submissions", "05_analytics"))
    prepared.mkdir()
    analytics.mkdir()
    payload, truth = sample_submission()
    manifest = {"version": 1, "dataset_id": payload["dataset_id"], "feature_names": ["jet_pt", "jet_sdmass"],
                "feature_source_sha256": "f" * 64, "splits": {}}
    for split in ("train", "validation", "test"):
        rows = [{"split": split, "record_id": f"{split}-{i:03d}", "truth_label": 0 if i % 2 else 161,
                 "truth_group": "signal" if i % 2 else "background", "source_file": f"{split}.parquet",
                 "source_row": i, "jet_pt": 300.0, "jet_sdmass": 50.0, "jet_nparticles": 2,
                 "in_training_support": True, "particles_truncated": False,
                 "part_energy": [3., 1.], "part_deta": [.1, .2], "part_dphi": [.2, .3]}
                for i in range(128)]
        path = prepared / f"{split}.parquet"
        pq.write_table(pa.Table.from_pylist(rows), path)
        manifest["splits"][split] = {"file": path.name, "rows": len(rows), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
    (prepared / "manifest.json").write_text(json.dumps(manifest))
    run = results / payload["run_id"]
    run.mkdir(parents=True)
    prediction_path = run / "predictions.parquet"
    pq.write_table(pa.Table.from_pylist(payload["predictions"]), prediction_path)
    result = {**payload, "status": "succeeded", "predictions": {"file": "predictions.parquet",
        "rows": len(payload["predictions"]), "sha256": hashlib.sha256(prediction_path.read_bytes()).hexdigest()}}
    (run / "result.json").write_text(json.dumps(result))
    return prepared, results, submissions, analytics


def write_reference(prepared, path):
    manifest, _, truth = load_prepared(prepared)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"version": 1, "dataset_id": manifest["dataset_id"], "splits": {
        split: [{"record_id": identifier, "label": label} for identifier, label in sorted(truth[split].items())]
        for split in ("validation", "test")}}))
    return path


def test_full_flow_preserves_every_jet_particle_score_and_metrics(comparison_files):
    prepared, results, submissions, analytics = comparison_files
    receipt = compare(*comparison_files)
    export = json.loads((analytics / "comparison.json").read_text())
    page = Path(receipt["model_explorer"])
    assert page == analytics / "model-explorer.html"
    embedded = re.search(r'<script type="application/json" id="model-explorer-data">(.*?)</script>',
                         page.read_text(), re.DOTALL)
    assert embedded and json.loads(embedded.group(1)) == export
    assert receipt["experiments"] == 1
    assert len(export["jets"]) == 200
    assert len(export["population"]) == len(export["predictions"]) == 256
    assert export["leaderboard"]["quality"][0]["test_auc"] == 1
    assert export["experiments"][0]["trained"] is True
    assert len(receipt["submission_files"]) == 1
    assert json.loads(Path(receipt["submission_files"][0]).read_text())["trained"] is True
    with duckdb.connect(str(analytics / "analytics.duckdb"), read_only=True) as db:
        assert db.execute("SELECT count(*) FROM jets").fetchone()[0] == 384
        assert db.execute("SELECT count(*) FROM particles").fetchone()[0] == 768
        assert db.execute("SELECT count(*) FROM predictions").fetchone()[0] == 256
        assert db.execute("SELECT split, roc_auc FROM experiment_comparison ORDER BY split").fetchall() == [("test", 1.), ("validation", 1.)]
    # Recollection sees the generated submission too, without duplicating it.
    assert compare(*comparison_files)["experiments"] == 1
    with duckdb.connect(str(analytics / "analytics.duckdb"), read_only=True) as db:
        assert db.execute("SELECT count(*) FROM predictions").fetchone()[0] == 256


def test_generated_explorer_includes_all_successful_runs_in_custom_output_dir(comparison_files, tmp_path):
    prepared, results, submissions, _ = comparison_files
    first_path = next(results.glob("*/result.json"))
    first = json.loads(first_path.read_text())
    second_dir = results / "planned-shape"
    second_dir.mkdir()
    shutil.copyfile(first_path.parent / "predictions.parquet", second_dir / "predictions.parquet")
    second = {**first, "run_id": "planned-shape", "experiment_id": "shape", "feature_set": "shape"}
    (second_dir / "result.json").write_text(json.dumps(second))
    failed = results / "failed"
    failed.mkdir()
    (failed / "result.json").write_text(json.dumps({"status": "failed"}))
    output = tmp_path / "Custom outputs" / "nested"
    receipt = compare(prepared, results, submissions, output)
    html = Path(receipt["model_explorer"]).read_text()
    match = re.search(r'<script type="application/json" id="model-explorer-data">(.*?)</script>', html, re.DOTALL)
    embedded = json.loads(match.group(1))
    assert receipt["experiments"] == 2
    assert {row["run_id"] for row in embedded["experiments"]} == {first["run_id"], "planned-shape"}
    assert len(embedded["predictions"]) == 2 * first["predictions"]["rows"]
    assert embedded == json.loads((output / "comparison.json").read_text())


def test_missing_explorer_assets_fail_before_replacing_comparison(comparison_files, monkeypatch):
    import importlib
    compare_module = importlib.import_module("postprocessing.compare")
    _, _, _, analytics = comparison_files
    compare(*comparison_files)
    original = {path.name: path.read_bytes() for path in analytics.iterdir()}
    def unavailable():
        raise ValueError("Cannot read model explorer assets")
    monkeypatch.setattr(compare_module, "load_template", unavailable)
    with pytest.raises(ValueError, match="Cannot read model explorer assets"):
        compare(*comparison_files)
    assert {path.name: path.read_bytes() for path in analytics.iterdir()} == original


@pytest.mark.parametrize("trained", [True, False])
def test_custom_model_training_status_survives_collect_export_and_json_only_reload(comparison_files, trained):
    prepared, results, submissions, analytics = comparison_files
    result_path = next(results.glob("*/result.json"))
    result = json.loads(result_path.read_text())
    result.update(model="custom_classifier", trained=trained,
                  parameters={"criterion": "gini", "bootstrap": True, "max_features": None})
    result_path.write_text(json.dumps(result))
    receipt = compare(*comparison_files)
    submitted = json.loads(Path(receipt["submission_files"][0]).read_text())
    assert submitted["trained"] is trained and submitted["model"] == "custom_classifier"
    shutil.rmtree(results)
    compare(prepared, results, submissions, analytics)
    export = json.loads((analytics / "comparison.json").read_text())
    assert export["experiments"][0]["trained"] is trained
    assert len(export["leaderboard"]["quality"]) == int(trained)
    assert len(export["leaderboard"]["references"]) == int(not trained)
    with duckdb.connect(str(analytics / "analytics.duckdb"), read_only=True) as db:
        metadata = json.loads(db.execute("SELECT metadata FROM experiments").fetchone()[0])
        assert metadata["trained"] is trained


def test_database_is_portable_without_source_parquet(comparison_files, tmp_path):
    compare(*comparison_files)
    snapshot = tmp_path / "shared.duckdb"
    shutil.copyfile(comparison_files[3] / "analytics.duckdb", snapshot)
    shutil.rmtree(comparison_files[0])
    shutil.rmtree(comparison_files[1])
    shutil.rmtree(comparison_files[3])
    with duckdb.connect(str(snapshot), read_only=True) as db:
        assert db.execute("SELECT sum(energy_gev) FROM particles").fetchone()[0] == 384 * 4.
        assert db.execute("SELECT count(*) FROM experiment_comparison").fetchone()[0] == 2


def test_failed_database_replacement_rolls_back_the_complete_previous_snapshot(comparison_files):
    prepared, _, _, analytics = comparison_files
    compare(*comparison_files)
    manifest, datasets, truth = load_prepared(prepared)
    payload, _ = sample_submission()
    checked = validate_submission(payload, manifest["dataset_id"], truth)
    checked["source"] = "local"
    duplicate = copy.deepcopy(checked)
    with pytest.raises(duckdb.ConstraintException, match="duplicate key"):
        with AnalyticsStore(analytics / "analytics.duckdb") as store:
            store.replace(manifest, datasets, [checked, duplicate])
    with duckdb.connect(str(analytics / "analytics.duckdb"), read_only=True) as db:
        assert db.execute("SELECT count(*) FROM experiments").fetchone()[0] == 1
        assert db.execute("SELECT count(*) FROM predictions").fetchone()[0] == 256
        assert db.execute("SELECT count(*) FROM particles").fetchone()[0] == 768


def test_json_only_submission_can_be_compared_without_any_models_or_local_runs(comparison_files):
    prepared, results, submissions, analytics = comparison_files
    compare(*comparison_files)
    shutil.rmtree(results)
    receipt = compare(prepared, results, submissions, analytics)
    assert receipt["experiments"] == 1
    export = json.loads((analytics / "comparison.json").read_text())
    assert export["experiments"][0]["source"] == "submission"
    assert export["experiments"][0]["reporting"].startswith("Team-reported")


def test_shared_board_build_uses_only_standard_library_and_recomputes_quality(comparison_files, tmp_path):
    compare(*comparison_files)
    evaluation = write_reference(comparison_files[0], tmp_path / "config" / "evaluation.json")
    output = tmp_path / "public" / "leaderboard.json"
    process = subprocess.run([sys.executable, "-S", "-m", "postprocessing.leaderboard",
        "--evaluation", str(evaluation), "--submissions", str(comparison_files[2]), "--output", str(output)],
        capture_output=True, text=True, timeout=20,
        env={**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1] / "src")})
    assert process.returncode == 0, process.stderr
    board = json.loads(output.read_text())
    assert board["submission_count"] == 1
    assert board["leaderboard"]["quality"][0]["test_auc"] == 1.0
    assert "predictions" not in board["experiments"][0]


def test_corrupted_prepared_or_saved_predictions_never_replace_database(comparison_files):
    prepared, results, submissions, analytics = comparison_files
    compare(*comparison_files)
    path = next(results.glob("*/predictions.parquet"))
    path.write_bytes(b"invalid parquet")
    with pytest.raises(ValueError, match="do not match result.json"):
        compare(prepared, results, submissions, analytics)
    with duckdb.connect(str(analytics / "analytics.duckdb"), read_only=True) as db:
        assert db.execute("SELECT count(*) FROM experiments").fetchone()[0] == 1
    (prepared / "test.parquet").write_bytes(b"invalid parquet")
    with pytest.raises(ValueError, match="checksum"):
        load_prepared(prepared)


def test_unknown_database_is_not_overwritten(comparison_files):
    _, _, _, analytics = comparison_files
    with duckdb.connect(str(analytics / "analytics.duckdb")) as db:
        db.execute("CREATE TABLE precious AS SELECT 42 AS answer")
    with pytest.raises(ValueError, match="unknown or incompatible"):
        compare(*comparison_files)
    with duckdb.connect(str(analytics / "analytics.duckdb"), read_only=True) as db:
        assert db.execute("SELECT answer FROM precious").fetchone()[0] == 42


def test_canonical_reference_is_checked_and_never_overwritten(comparison_files, tmp_path):
    reference = write_reference(comparison_files[0], tmp_path / "config" / "evaluation.json")
    original = reference.read_bytes()
    compare(*comparison_files, reference_path=reference)
    assert reference.read_bytes() == original
    assert not (comparison_files[3] / "evaluation.json").exists()
    changed = json.loads(original)
    changed["splits"]["test"][0]["label"] = 1 - changed["splits"]["test"][0]["label"]
    reference.write_text(json.dumps(changed))
    with pytest.raises(ValueError, match="canonical reference"):
        compare(*comparison_files, reference_path=reference)
