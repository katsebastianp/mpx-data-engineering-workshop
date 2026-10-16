"""Preserve a complete model-worktree batch when exporting the combined result."""

import copy
import hashlib
import json
import re
import shutil

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from postprocessing.compare import compare, main
from postprocessing.leaderboard import validate_submission
from test_compare import comparison_files, write_reference
from test_competition import sample_submission


def write_validation_run(results, run_id, experiment_id, *, custom=False):
    payload, truth = sample_submission(final=False)
    payload.update(run_id=run_id, experiment_id=experiment_id, trained=True)
    if custom:
        payload.update(model="custom_classifier", parameters={
            "objective": "binary:logistic", "eval_metric": "error@0.5",
            "hidden_layer_sizes": [32, 16], "interaction_constraints": [[0, 1], [2]],
        })
    payload["metrics"] = validate_submission(payload, payload["dataset_id"], truth)["metrics"]
    run = results / run_id
    run.mkdir(parents=True)
    prediction_path = run / "predictions.parquet"
    pq.write_table(pa.Table.from_pylist(payload["predictions"]), prediction_path)
    result = {**payload, "status": "succeeded", "predictions": {
        "file": prediction_path.name, "rows": len(payload["predictions"]),
        "sha256": hashlib.sha256(prediction_path.read_bytes()).hexdigest(),
    }}
    (run / "result.json").write_text(json.dumps(result))


@pytest.fixture
def validation_archive(comparison_files, tmp_path):
    _, results, _, analytics = comparison_files
    shutil.rmtree(results)
    for experiment in ("linear-basic", "library", "tuned"):
        write_validation_run(results, f"planned-{experiment}", experiment, custom=experiment == "library")
    compare(*comparison_files)
    archive = tmp_path / "evidence" / "models" / "comparison.json"
    archive.parent.mkdir(parents=True)
    shutil.copyfile(analytics / "comparison.json", archive)
    return comparison_files, archive


def test_integration_preserves_complete_batch_without_original_runs(validation_archive):
    files, archive = validation_archive
    _, results, submissions, analytics = files
    original = archive.read_bytes()
    planned = json.loads(original)
    shutil.rmtree(results)
    write_validation_run(results, "integration-library", "library", custom=True)

    receipt = compare(*files, import_comparisons=[archive])
    merged = json.loads((analytics / "comparison.json").read_text())
    assert receipt["experiments"] == 4
    assert {row["run_id"] for row in merged["experiments"]} == {
        "planned-linear-basic", "planned-library", "planned-tuned", "integration-library",
    }
    for before in planned["experiments"]:
        after = next(row for row in merged["experiments"] if row["experiment_key"] == before["experiment_key"])
        assert after == {**before, "source": "comparison"}
        assert [row for row in merged["predictions"] if row["experiment_key"] == before["experiment_key"]] == [
            row for row in planned["predictions"] if row["experiment_key"] == before["experiment_key"]]
    assert merged["population"] == planned["population"]
    assert len(merged["predictions"]) == 4 * 128
    assert all(row["split"] == "validation" for field in ("population", "predictions", "jets") for row in merged[field])
    assert merged["leaderboard"]["quality"] == []
    assert receipt["submission_files"] == [] and not submissions.exists()
    html = (analytics / "model-explorer.html").read_text()
    embedded = re.search(r'<script type="application/json" id="model-explorer-data">(.*?)</script>', html, re.DOTALL)
    assert json.loads(embedded.group(1)) == merged
    assert archive.read_bytes() == original


def test_repeated_and_reordered_imports_deduplicate_the_same_runs(validation_archive, tmp_path):
    files, archive = validation_archive
    reordered = json.loads(archive.read_text())
    reordered["predictions"].reverse()
    second = tmp_path / "reordered.json"
    second.write_text(json.dumps(reordered))
    assert compare(*files, import_comparisons=[archive, second, archive])["experiments"] == 3


def test_cli_can_rebuild_from_saved_comparison_alone(validation_archive, tmp_path, capsys):
    files, archive = validation_archive
    prepared, results, submissions, _ = files
    shutil.rmtree(results)
    reference = write_reference(prepared, tmp_path / "config" / "evaluation.json")
    output = tmp_path / "rebuilt"
    assert main([
        "--prepared-dir", str(prepared), "--results-dir", str(results),
        "--submissions-dir", str(submissions), "--output-dir", str(output),
        "--reference", str(reference), "--import-comparison", str(archive),
        "--import-comparison", str(archive),
    ]) == 0
    assert json.loads(capsys.readouterr().out)["experiments"] == 3
    assert (output / "model-explorer.html").is_file()


def test_cli_rejects_deeply_nested_json_without_replacing_outputs(validation_archive, tmp_path, caplog):
    files, archive = validation_archive
    prepared, results, submissions, analytics = files
    reference = write_reference(prepared, tmp_path / "config" / "evaluation.json")
    original = {path.name: path.read_bytes() for path in analytics.iterdir()}
    archive.write_text('{"nested":' + '[' * 2_000 + '0' + ']' * 2_000 + '}')
    assert main([
        "--prepared-dir", str(prepared), "--results-dir", str(results),
        "--submissions-dir", str(submissions), "--output-dir", str(analytics),
        "--reference", str(reference), "--import-comparison", str(archive),
    ]) == 1
    assert "Comparison JSON nesting is too deep." in caplog.text
    assert "RecursionError" not in caplog.text
    assert {path.name: path.read_bytes() for path in analytics.iterdir()} == original


@pytest.mark.parametrize("damage", [
    "wrong_dataset", "missing_prediction", "duplicate_prediction", "unknown_experiment",
    "changed_identity", "changed_metric", "duplicate_experiment", "wrong_population",
    "test_evaluation", "conflicting_run",
])
def test_invalid_import_never_replaces_existing_outputs(validation_archive, damage):
    files, archive = validation_archive
    analytics = files[3]
    original = {path.name: path.read_bytes() for path in analytics.iterdir()}
    export = json.loads(archive.read_text())
    first = export["experiments"][0]
    if damage == "wrong_dataset":
        export["dataset_id"] = "0" * 64
    elif damage == "missing_prediction":
        export["predictions"].pop()
    elif damage == "duplicate_prediction":
        export["predictions"].append(copy.deepcopy(export["predictions"][0]))
    elif damage == "unknown_experiment":
        export["predictions"][0]["experiment_key"] = "not-a-declared-experiment"
    elif damage == "changed_identity":
        first["team"] = "Different team"
    elif damage == "changed_metric":
        first["metrics"]["validation"]["roc_auc"] = 0.1
    elif damage == "duplicate_experiment":
        export["experiments"].append(copy.deepcopy(first))
    elif damage == "wrong_population":
        export["population"][0]["truth_label"] = 0
    elif damage == "test_evaluation":
        first["evaluated_splits"] = ["validation", "test"]
    elif damage == "conflicting_run":
        first["parameters"]["changed"] = True
    archive.write_text(json.dumps(export))
    with pytest.raises(ValueError):
        compare(*files, import_comparisons=[archive])
    assert {path.name: path.read_bytes() for path in analytics.iterdir()} == original
