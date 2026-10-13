"""Recompute experiment quality, save DuckDB analytics and export a Sites comparison."""

from __future__ import annotations

import argparse
import json
import logging
import math
from pathlib import Path

import pyarrow.parquet as pq

from common import (
    ANALYTICS_DIR, CONFIG_DIR, PREDICTIONS_DIR, PREPROCESSED_DIR, SUBMISSIONS_DIR,
    sha256, write_json,
)
from postprocessing.database import AnalyticsStore
from postprocessing.leaderboard import (
    FIELDS, leaderboard, load_evaluation, make_submission, read_json, submission_name, validate_submission,
)

LOGGER = logging.getLogger(__name__)
SPLITS = ("train", "validation", "test")


def _validate_jet(row: dict, feature_names: list[str]) -> None:
    label = row.get("truth_label")
    valid_label = type(label) is int and (label == 0 or 161 <= label <= 187)
    group = "signal" if label == 0 else "background"
    if not valid_label or row.get("truth_group") != group:
        raise ValueError("Prepared simulation labels must describe Xbb versus QCD.")
    if any(isinstance(row.get(name), bool) or not isinstance(row.get(name), (float, int))
           or not math.isfinite(row[name]) for name in feature_names):
        raise ValueError("Prepared model features must be finite numbers.")
    count = row.get("jet_nparticles")
    if type(count) is not int or count <= 0:
        raise ValueError("Prepared jets require a positive particle count.")
    for name in ("part_energy", "part_deta", "part_dphi"):
        array = row.get(name)
        if (not isinstance(array, list) or len(array) != count
                or any(isinstance(value, bool) or not isinstance(value, (float, int))
                       or not math.isfinite(value) for value in array)):
            raise ValueError("Prepared particle arrays must be finite and aligned.")
    if min(row["part_energy"]) < 0 or sum(row["part_energy"]) <= 0:
        raise ValueError("Prepared particle energies must be nonnegative with positive total energy.")
    if any(type(row.get(name)) is not bool for name in ("in_training_support", "particles_truncated")):
        raise ValueError("Prepared jets require explicit support and truncation flags.")
    if (row["in_training_support"] != (200 < row["jet_pt"] < 2500 and 20 < row["jet_sdmass"] < 500)
            or row["particles_truncated"] != (count > 128)):
        raise ValueError("Prepared support/truncation flags differ from the measurements.")


def load_prepared(directory: Path) -> tuple[dict, dict[str, list[dict]], dict[str, dict[str, int]]]:
    """Read only pinned split files, preserving every ID and all measured particles."""
    manifest = read_json(directory / "manifest.json")
    if manifest.get("version") != 1 or set(manifest.get("splits", {})) != set(SPLITS):
        raise ValueError("Prepared data requires a version-1 train/validation/test manifest.")
    names = manifest.get("feature_names")
    if not isinstance(names, list) or not names or len(names) != len(set(names)):
        raise ValueError("Prepared manifest requires unique feature_names.")
    datasets, truth, seen = {}, {}, set()
    for split in SPLITS:
        entry = manifest["splits"][split]
        if entry["file"] != f"{split}.parquet":
            raise ValueError("Prepared split filenames must be train.parquet, validation.parquet and test.parquet.")
        path = directory / entry["file"]
        if path.is_symlink() or sha256(path) != entry["sha256"]:
            raise ValueError(f"Prepared {split} checksum differs from its manifest.")
        table = pq.read_table(path)
        if len(table.column_names) != len(set(table.column_names)):
            raise ValueError("Prepared Parquet contains duplicate column names.")
        rows = table.to_pylist()
        if not rows or len(rows) != entry["rows"]:
            raise ValueError(f"Prepared {split} row count differs from its manifest.")
        labels = {}
        for row in rows:
            identifier, label = row.get("record_id"), row.get("truth_label")
            if (not isinstance(identifier, str) or not identifier or identifier in seen
                    or row.get("split") != split):
                raise ValueError("Prepared IDs must be unique and disjoint across the declared splits.")
            _validate_jet(row, names)
            seen.add(identifier)
            labels[identifier] = int(label == 0)
        if set(labels.values()) != {0, 1}:
            raise ValueError(f"Prepared {split} must contain both truth groups.")
        datasets[split], truth[split] = rows, labels
    return manifest, datasets, truth


def _load_local_submission(path: Path, result: dict) -> dict:
    prediction_path = path.parent / "predictions.parquet"
    if prediction_path.is_symlink():
        raise ValueError("Prediction files must be local regular files.")
    recorded = result.get("predictions", {})
    if (recorded.get("file") != "predictions.parquet"
            or sha256(prediction_path) != recorded.get("sha256")):
        raise ValueError(f"Saved predictions do not match result.json: {path.parent.name}")
    table = pq.read_table(prediction_path)
    if len(table.column_names) != 3 or set(table.column_names) != {"split", "record_id", "signal_score"}:
        raise ValueError("Prediction Parquet requires exactly split, record_id and signal_score.")
    predictions = table.to_pylist()
    if len(predictions) != recorded.get("rows"):
        raise ValueError("Saved prediction count differs from result.json.")
    return make_submission(result, predictions)


def collect_experiments(results_dir: Path, submissions_dir: Path, dataset_id: str,
                        truth: dict[str, dict[str, int]]) -> tuple[list[dict], list[dict]]:
    """Collect completed local runs and optional team JSON without executing their code."""
    experiments, local, identities = [], [], {}

    def add(payload: dict, source: str) -> dict:
        checked = validate_submission(payload, dataset_id, truth)
        key = checked["experiment_key"]
        canonical = json.dumps({name: checked[name] for name in FIELDS}, sort_keys=True, allow_nan=False)
        if key in identities:
            if identities[key] != canonical:
                raise ValueError(f"Conflicting results for {checked['team']} / {checked['run_id']}.")
            return checked
        identities[key] = canonical
        checked["source"] = source
        if not checked["reported_metrics_match"]:
            LOGGER.warning("Replaced inconsistent reported metrics for %s with recomputed values", checked["run_id"])
        experiments.append(checked)
        return checked

    for path in sorted(results_dir.glob("*/result.json")):
        result = read_json(path)
        if result.get("status") != "succeeded":
            LOGGER.warning("Skipping incomplete experiment %s", path.parent.name)
            continue
        payload = _load_local_submission(path, result)
        checked = add(payload, "local")
        local.append(checked)
    if submissions_dir.is_dir():
        for path in sorted(submissions_dir.glob("*.json")):
            add(read_json(path), "submission")
    if not experiments:
        raise ValueError("No completed predictions or valid submissions found; run the prediction stage first.")
    return experiments, local


def _display_jet(row: dict, feature_names: list[str]) -> dict:
    return {
        "record_id": row["record_id"],
        "split": row["split"],
        "truth": {"label": row["truth_label"], "group": row["truth_group"]},
        "in_training_support": row["in_training_support"],
        "particles_truncated": row["particles_truncated"],
        "features": {name: row[name] for name in feature_names},
        "energy_flow": [
            {"deta": eta, "dphi": phi, "energy_gev": energy}
            for energy, eta, phi in zip(row["part_energy"], row["part_deta"], row["part_dphi"])
        ],
    }


def discovery_export(manifest: dict, datasets: dict[str, list[dict]], experiments: list[dict]) -> dict:
    """Full score population plus 200 bounded angular displays, ready to host with Sites."""
    evaluated = sorted({split for experiment in experiments for split in experiment["evaluated_splits"]})
    jets, population = [], []
    quota = 200 // (2 * len(evaluated))
    for split in evaluated:
        ordered = sorted(datasets[split], key=lambda row: row["record_id"])
        for row in ordered:
            population.append({name: row[name] for name in ("split", "record_id", "truth_label", "truth_group",
                                                            "in_training_support", "particles_truncated")})
        for group in ("signal", "background"):
            for row in [row for row in ordered if row["truth_group"] == group][:quota]:
                jets.append(_display_jet(row, manifest["feature_names"]))
    return {"version": 1, "title": "Find the signal without drowning in data", "dataset_id": manifest["dataset_id"],
        "data_kind": "Simulated collider jets; not a live feed or a physics discovery.",
        "coordinates": {"x": "deta: pseudorapidity difference from the jet axis",
                        "y": "dphi: azimuthal angle difference from the jet axis (radians)",
                        "size": "particle energy in GeV", "meaning": "angular energy flow, not spatial detector tracks"},
        "comparison_policy": "Validation is for iteration. Test results are explicitly final selections. Sophon uses richer inputs and prior training; this is a system comparison.",
        "score_semantics": "Model scores are not calibrated collider probabilities. Labels are simulated truth, kept separate from predictions.",
        "experiments": [{key: value for key, value in row.items() if key != "predictions"} for row in experiments],
        "predictions": [{"experiment_key": experiment["experiment_key"], **row}
                        for experiment in experiments for row in experiment["predictions"]],
        "population": population, "jets": jets, "leaderboard": leaderboard(experiments),
        "display_sampling": "Up to 200 jets, split evenly by evaluated split and truth group, ordered by record_id.",
        "threshold_policy": "Compute threshold curves from complete prediction/population rows, never the 200 display jets."}


def _write_submissions(local: list[dict], submissions_dir: Path) -> list[str]:
    submission_files = []
    # Select exports on validation quality, before looking at final test scores.
    candidates = sorted([row for row in local if row["test_selection"] == "final"], key=lambda row: (
        -row["metrics"]["validation"]["roc_auc"], row["timings"]["normalized_inference_time"], row["run_id"]))
    teams = set()
    for experiment in candidates:
        if experiment["team"] in teams:
            continue
        teams.add(experiment["team"])
        path = submissions_dir / submission_name(experiment)
        write_json(path, {name: experiment[name] for name in FIELDS})
        submission_files.append(str(path))
    return submission_files


def compare(prepared_dir: Path, results_dir: Path, submissions_dir: Path, output_dir: Path,
            reference_path: Path | None = None) -> dict:
    manifest, datasets, truth = load_prepared(prepared_dir)
    if reference_path is not None:
        dataset_id, reference_truth = load_evaluation(reference_path)
        if dataset_id != manifest["dataset_id"] or reference_truth != {split: truth[split] for split in ("validation", "test")}:
            raise ValueError("Prepared evaluation IDs or labels differ from the canonical reference.")
    experiments, local = collect_experiments(results_dir, submissions_dir, manifest["dataset_id"], truth)
    export = discovery_export(manifest, datasets, experiments)
    database = output_dir / "analytics.duckdb"
    with AnalyticsStore(database) as store:
        store.replace(manifest, datasets, experiments)
    submission_files = _write_submissions(local, submissions_dir)
    export["submission_files"] = submission_files
    write_json(output_dir / "comparison.json", export)
    LOGGER.info("Compared %d experiments; saved actual jet/particle data to %s", len(experiments), database)
    return {"experiments": len(experiments), "database": str(database),
            "sites_export": str(output_dir / "comparison.json"), "submission_files": submission_files}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepared-dir", type=Path, default=PREPROCESSED_DIR)
    parser.add_argument("--results-dir", type=Path, default=PREDICTIONS_DIR)
    parser.add_argument("--submissions-dir", type=Path, default=SUBMISSIONS_DIR)
    parser.add_argument("--output-dir", type=Path, default=ANALYTICS_DIR)
    parser.add_argument("--reference", type=Path, default=CONFIG_DIR / "evaluation.json")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        print(json.dumps(compare(args.prepared_dir, args.results_dir, args.submissions_dir,
                                 args.output_dir, args.reference), indent=2))
        return 0
    except Exception:
        LOGGER.exception("Cannot compare results; fix the reported data or submission error and retry")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
