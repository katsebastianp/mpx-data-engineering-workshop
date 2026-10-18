"""Train CPU models, evaluate held-out jets and save one result per experiment.

Run: python -m predict. Fits may run in two processes; latency measurements run
serially after every fit has completed.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Sequence
    from predict.base import Predictor
    from workshop_types import (
        Datasets,
        ExperimentConfig,
        FilePath,
        FitResult,
        Job,
        Metrics,
        Parameters,
        Prediction,
        Record,
        Rows,
    )

from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
import argparse
import json
import logging
import multiprocessing
import os
from pathlib import Path
import re
import time
import uuid

import pyarrow as pa
import pyarrow.parquet as pq

from common import CONFIG_DIR, MODELS_DIR, PREDICTIONS_DIR, PREPROCESSED_DIR, sha256, write_json
from predict.benchmark import benchmark_model, hardware_info
from predict.config import read_config
from predict.data import load_prepared
from predict.metrics import classification_metrics
from predict.models import load_model, train_model

LOGGER = logging.getLogger(__name__)


def _prepare_jobs(
    config: ExperimentConfig,
    results_dir: FilePath,
    models_dir: FilePath,
    run_id: str | None,
) -> list[Job]:
    """Validate every output path before creating any files."""
    prefix = run_id
    if prefix is None:
        prefix = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:6]
    if not isinstance(prefix, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,59}", prefix):
        raise ValueError("Run ID must contain 1–60 letters/digits/hyphens/underscores.")
    jobs = []
    for entry in config["experiments"]:
        directory = Path(results_dir) / f"{prefix}-{entry['id']}"
        model_directory = Path(models_dir) / directory.name
        if len(directory.name) > 80:
            raise ValueError("The run ID prefix plus experiment ID must fit within 80 characters; shorten --run-id.")
        if directory.exists():
            raise ValueError(f"Result already exists: {directory}; previous results are immutable.")
        if model_directory.exists():
            raise ValueError(f"Model output already exists: {model_directory}; previous models are immutable.")
        prediction_path, model_path = directory.resolve(), model_directory.resolve()
        if prediction_path.is_relative_to(model_path) or model_path.is_relative_to(prediction_path):
            raise ValueError("Prediction and model run directories must be separate and must not overlap.")
        jobs.append((entry, directory, model_directory))
    return jobs


def _fit_job(
    kind: str,
    train_rows: Rows,
    names: list[str],
    params: Parameters,
    output: Path,
    seed: int,
) -> FitResult:
    start = time.perf_counter()
    metadata = train_model(kind, train_rows, names, params, output, seed)
    elapsed = time.perf_counter() - start
    training_seconds = elapsed if metadata["trained"] else 0.0
    setup_seconds = 0.0 if metadata["trained"] else elapsed
    return metadata, training_seconds, setup_seconds


def _fit_jobs(jobs: list[Job], train_rows: Rows, config: ExperimentConfig) -> list[FitResult]:
    arguments = [
        (entry["model"], [] if entry["model"] == "sophon" else train_rows,
         entry["feature_names"], entry["params"], model_directory, config["seed"])
        for entry, _, model_directory in jobs
    ]
    if config["max_workers"] == 1:
        return [_fit_job(*args) for args in arguments]
    # Closing the pool before returning keeps training out of latency measurements.
    with ProcessPoolExecutor(max_workers=2, mp_context=multiprocessing.get_context("spawn")) as pool:
        futures = [pool.submit(_fit_job, *args) for args in arguments]
        return [future.result() for future in futures]


def _evaluate_splits(
    model: Predictor,
    splits: Datasets,
    evaluation: str,
) -> tuple[dict[str, Metrics], list[Prediction]]:
    evaluated = ["validation", "test"] if evaluation == "test" else ["validation"]
    metrics: dict[str, Metrics]
    predictions: list[Prediction]
    metrics, predictions = {}, []
    for split in evaluated:
        rows = splits[split]
        scores = model.predict(rows)
        labels = [int(row["truth_label"] == 0) for row in rows]
        metrics[split] = classification_metrics(labels, scores)
        predictions.extend(
            {"split": split, "record_id": row["record_id"], "signal_score": float(score)}
            for row, score in zip(rows, scores)
        )
    return metrics, predictions


def _save_result(
    job: Job,
    config: ExperimentConfig,
    manifest: Record,
    metadata: Record,
    metrics: dict[str, Metrics],
    predictions: list[Prediction],
    timings: dict[str, float],
    protocol: Record,
) -> Record:
    entry, directory, model_directory = job
    prediction_path = directory / "predictions.parquet"
    schema = pa.schema([
        ("split", pa.string()), ("record_id", pa.string()), ("signal_score", pa.float64()),
    ])
    pq.write_table(pa.Table.from_pylist(predictions, schema=schema), prediction_path)
    model_manifest = model_directory / "manifest.json"
    result = {
        "version": 1, "status": "succeeded", "run_id": directory.name, "experiment_id": entry["id"],
        "team": config["team"], "model": entry["model"], "trained": metadata["trained"],
        "feature_names": entry["feature_names"],
        "feature_set": entry["feature_set"], "parameters": metadata["parameters"],
        "dataset_id": manifest["dataset_id"], "seed": config["seed"],
        "feature_source_sha256": manifest["feature_source_sha256"],
        "decision_threshold": .5,
        "threshold_policy": "Fixed teaching threshold; not tuned on validation or test",
        "evaluation": config["evaluation"], "evaluated_splits": list(metrics),
        "test_selection": "final" if config["evaluation"] == "test" else "not_evaluated",
        "metrics": metrics, "timings": timings, "latency_protocol": protocol,
        "hardware": hardware_info(), "explanation": entry["explanation"],
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "model_artifact": {
            "path": Path(os.path.relpath(model_manifest, directory)).as_posix(),
            "sha256": sha256(model_manifest), "model_sha256": metadata["model_sha256"],
        },
        "predictions": {
            "file": "predictions.parquet", "rows": len(predictions), "sha256": sha256(prediction_path),
        },
    }
    write_json(directory / "result.json", result)
    LOGGER.info("Saved %s: validation ROC-AUC %.4f, %.3f ms/jet",
                directory, metrics["validation"]["roc_auc"], timings["per_jet_ms"])
    return result


def run_experiments(
    config_path: FilePath = CONFIG_DIR / "experiments.yaml",
    prepared_dir: FilePath = PREPROCESSED_DIR,
    results_dir: FilePath = PREDICTIONS_DIR,
    run_id: str | None = None,
    models_dir: FilePath = MODELS_DIR,
) -> list[Record]:
    config = read_config(config_path)
    jobs = _prepare_jobs(config, results_dir, models_dir, run_id)
    manifest, splits = load_prepared(prepared_dir)
    for _, directory, _ in jobs:
        directory.mkdir(parents=True)
    try:
        fitted = _fit_jobs(jobs, splits["train"], config)
        results = []
        for job, (metadata, training_seconds, setup_seconds) in zip(jobs, fitted):
            entry, _, _ = job
            LOGGER.info("Evaluating %s (%s); timing is serial", entry["id"], entry["model"])
            model = load_model(metadata)
            metrics, predictions = _evaluate_splits(model, splits, config["evaluation"])
            timings, protocol = benchmark_model(model, splits["validation"])
            timings.update(training_seconds=training_seconds, frozen_model_setup_seconds=setup_seconds)
            results.append(_save_result(job, config, manifest, metadata, metrics, predictions, timings, protocol))
            del model
        return results
    except Exception as exc:
        for entry, directory, _ in jobs:
            if not (directory / "result.json").exists():
                write_json(directory / "result.json", {
                    "version": 1, "status": "failed", "run_id": directory.name,
                    "experiment_id": entry["id"],
                    "error": {"type": type(exc).__name__, "message": str(exc)},
                })
        LOGGER.exception("Experiment failed; incomplete outputs cannot enter the comparison")
        raise


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default=CONFIG_DIR / "experiments.yaml", type=Path)
    parser.add_argument("--prepared-dir", default=PREPROCESSED_DIR, type=Path)
    parser.add_argument("--results-dir", default=PREDICTIONS_DIR, type=Path)
    parser.add_argument("--models-dir", default=MODELS_DIR, type=Path)
    parser.add_argument("--run-id")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        results = run_experiments(args.config, args.prepared_dir, args.results_dir, args.run_id, args.models_dir)
        print(json.dumps({"completed": len(results), "run_ids": [row["run_id"] for row in results]}, indent=2))
        return 0
    except Exception as exc:
        LOGGER.error("Cannot complete experiments: %s", exc)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
