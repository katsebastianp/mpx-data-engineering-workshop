"""Persist the complete experiment comparison in a portable DuckDB file."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from workshop_types import Record

import json
import logging
from pathlib import Path

import duckdb
import pyarrow as pa

LOGGER = logging.getLogger(__name__)


class AnalyticsStore:
    """Own a DuckDB connection for atomic comparison writes; use as a context manager."""

    def __init__(self, path: Path) -> None:
        self.path = Path(path)

    def __enter__(self) -> AnalyticsStore:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._connection = duckdb.connect(str(self.path), config={
            "threads": "1",
            "memory_limit": "256MB",
            "max_temp_directory_size": "1GB",
            "autoload_known_extensions": "false",
            "autoinstall_known_extensions": "false",
        })
        return self

    def __exit__(self, *_: object) -> None:
        self._connection.close()

    def replace(self, manifest: Record, datasets: dict[str, list[Record]], experiments: list[Record]) -> None:
        """Replace the complete comparison in one transaction, preserving it on failure."""
        self._connection.execute("SET TimeZone = 'UTC'")
        self._connection.execute("BEGIN")
        try:
            self._ensure_schema()
            for table in ("metrics", "predictions", "experiments", "particles", "jets", "datasets"):
                self._connection.execute(f"DELETE FROM {table}")
            self._insert_dataset(manifest, datasets)
            for experiment in experiments:
                self._insert_experiment(experiment)
            self._connection.execute("COMMIT")
        except Exception:
            self._connection.execute("ROLLBACK")
            LOGGER.exception("Analytics replacement failed; previous results were preserved")
            raise
        self._connection.execute("CHECKPOINT")

    def _ensure_schema(self) -> None:
        tables = {row[0] for row in self._connection.execute("SHOW TABLES").fetchall()}
        if tables:
            if "comparison_schema" not in tables or self._connection.execute("SELECT version FROM comparison_schema").fetchall() != [(1,)]:
                raise ValueError("Refusing to replace an unknown or incompatible analytics database.")
            return
        self._connection.execute("""
            CREATE TABLE comparison_schema(version INTEGER PRIMARY KEY CHECK(version = 1));
            INSERT INTO comparison_schema VALUES (1);
            CREATE TABLE datasets(dataset_id VARCHAR PRIMARY KEY, manifest JSON NOT NULL);
            CREATE TABLE jets(
                dataset_id VARCHAR NOT NULL, split VARCHAR NOT NULL, record_id VARCHAR PRIMARY KEY,
                truth_label INTEGER NOT NULL, truth_group VARCHAR NOT NULL, source_file VARCHAR NOT NULL,
                source_row BIGINT NOT NULL, jet_pt DOUBLE NOT NULL, jet_sdmass DOUBLE NOT NULL,
                jet_nparticles INTEGER NOT NULL, in_training_support BOOLEAN NOT NULL,
                particles_truncated BOOLEAN NOT NULL, features JSON NOT NULL);
            CREATE TABLE particles(
                record_id VARCHAR NOT NULL, particle_index INTEGER NOT NULL,
                deta DOUBLE NOT NULL, dphi DOUBLE NOT NULL, energy_gev DOUBLE NOT NULL,
                PRIMARY KEY(record_id, particle_index));
            CREATE TABLE experiments(
                experiment_key VARCHAR PRIMARY KEY, run_id VARCHAR NOT NULL, experiment_id VARCHAR NOT NULL,
                team VARCHAR NOT NULL, model VARCHAR NOT NULL, dataset_id VARCHAR NOT NULL,
                feature_set VARCHAR NOT NULL, feature_names JSON NOT NULL, parameters JSON NOT NULL,
                final_test BOOLEAN NOT NULL, source VARCHAR NOT NULL, timestamp TIMESTAMPTZ NOT NULL,
                training_seconds DOUBLE NOT NULL, inference_seconds DOUBLE NOT NULL,
                reference_seconds DOUBLE NOT NULL, normalized_inference_time DOUBLE NOT NULL,
                hardware JSON NOT NULL, explanation VARCHAR NOT NULL, metadata JSON NOT NULL);
            CREATE TABLE predictions(
                experiment_key VARCHAR NOT NULL, split VARCHAR NOT NULL, record_id VARCHAR NOT NULL,
                signal_score DOUBLE NOT NULL CHECK(signal_score BETWEEN 0 AND 1),
                PRIMARY KEY(experiment_key, split, record_id));
            CREATE TABLE metrics(
                experiment_key VARCHAR NOT NULL, split VARCHAR NOT NULL, rows INTEGER NOT NULL,
                roc_auc DOUBLE NOT NULL, average_precision DOUBLE NOT NULL, accuracy DOUBLE NOT NULL,
                f1 DOUBLE NOT NULL, signal_retention DOUBLE NOT NULL, background_rejection DOUBLE NOT NULL,
                details JSON NOT NULL, PRIMARY KEY(experiment_key, split));
            CREATE VIEW experiment_comparison AS
                SELECT experiments.* EXCLUDE(metadata), metrics.* EXCLUDE(experiment_key, details)
                FROM experiments JOIN metrics USING(experiment_key);
        """)

    def _insert_dataset(self, manifest: Record, datasets: dict[str, list[Record]]) -> None:
        self._connection.execute("INSERT INTO datasets VALUES (?, ?)", [manifest["dataset_id"], json.dumps(manifest)])
        columns = ["split", "record_id", "truth_label", "truth_group", "source_file", "source_row",
                   "jet_pt", "jet_sdmass", "jet_nparticles", "in_training_support", "particles_truncated",
                   "part_energy", "part_deta", "part_dphi"]
        rows = [{**{name: row[name] for name in columns},
                 "features": json.dumps({name: row[name] for name in manifest["feature_names"]}, allow_nan=False)}
                for split in ("train", "validation", "test") for row in datasets[split]]
        self._connection.register("prepared_rows", pa.Table.from_pylist(rows))
        self._connection.execute("""
            INSERT INTO jets SELECT ?, split, record_id, truth_label, truth_group, source_file, source_row,
                jet_pt, jet_sdmass, jet_nparticles, in_training_support, particles_truncated, features
            FROM prepared_rows
        """, [manifest["dataset_id"]])
        self._connection.execute("""
            INSERT INTO particles SELECT record_id, unnest(range(jet_nparticles)),
                unnest(part_deta), unnest(part_dphi), unnest(part_energy) FROM prepared_rows
        """)
        self._connection.unregister("prepared_rows")

    def _insert_experiment(self, experiment: Record) -> None:
        timings = experiment["timings"]
        metadata = {key: value for key, value in experiment.items() if key != "predictions"}
        self._connection.execute("INSERT INTO experiments VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [
            experiment["experiment_key"], experiment["run_id"], experiment["experiment_id"],
            experiment["team"], experiment["model"], experiment["dataset_id"], experiment["feature_set"],
            json.dumps(experiment["feature_names"]), json.dumps(experiment["parameters"]),
            experiment["test_selection"] == "final", experiment["source"], experiment["timestamp"],
            timings["training_seconds"], timings["inference_seconds"], timings["reference_seconds"],
            timings["normalized_inference_time"], json.dumps(experiment["hardware"]),
            experiment["explanation"], json.dumps(metadata, allow_nan=False)])
        self._connection.register("prediction_rows", pa.Table.from_pylist(experiment["predictions"]))
        self._connection.execute("INSERT INTO predictions SELECT ?, split, record_id, signal_score FROM prediction_rows",
                           [experiment["experiment_key"]])
        self._connection.unregister("prediction_rows")
        for split, metrics in experiment["metrics"].items():
            self._connection.execute("INSERT INTO metrics VALUES (?,?,?,?,?,?,?,?,?,?)", [
                experiment["experiment_key"], split, metrics["rows"], metrics["roc_auc"],
                metrics["average_precision"], metrics["accuracy"], metrics["f1"],
                metrics["signal_retention"], metrics["background_rejection"], json.dumps(metrics)])
