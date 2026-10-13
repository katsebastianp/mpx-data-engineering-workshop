"""Run the editable Spark preprocessing job: docker compose run --rm lab -m preprocessing."""

import hashlib
import json
import logging
import shutil
import tempfile
import time
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from preprocessing.features import FEATURE_NAMES, FEATURE_SETS, build_features
from common import ROOT, RAW_DIR, PREPROCESSED_DIR, sha256, utc_now, write_json

LOGGER = logging.getLogger(__name__)
SHUFFLE_PARTITIONS = 64


def execution_counts(context):
    """Count unique scheduled stages; these are planned tasks, not retry attempts."""
    tracker = context.statusTracker()
    jobs = [tracker.getJobInfo(identifier) for identifier in tracker.getJobIdsForGroup("particle-preprocessing")]
    if not jobs or any(job is None for job in jobs):
        raise ValueError("Spark job metadata is unavailable for task counting.")
    identifiers = {int(stage) for job in jobs for stage in job.stageIds}
    stages = [tracker.getStageInfo(identifier) for identifier in identifiers]
    if any(stage is None for stage in stages):
        raise ValueError("Spark stage metadata is unavailable for task counting.")
    return {"job_count": len(jobs), "stage_count": len(stages),
            "scheduled_tasks": sum(stage.numTasks for stage in stages)}


def _read_raw_manifest(directory):
    manifest = json.loads((directory / "manifest.json").read_text())
    if set(manifest["splits"]) != {"train", "validation", "test"}:
        raise ValueError("Expected separate train, validation and test files.")
    signature = {name: manifest["splits"][name]["sha256"] for name in sorted(manifest["splits"])}
    identity = hashlib.sha256(json.dumps(signature, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    if manifest.get("dataset_id") != identity:
        raise ValueError("Dataset identity does not match its split files.")
    return manifest


def _check_raw_split(directory, split, entry):
    """Validate one split and return its record IDs for the overlap check."""
    if entry["file"] != f"{split}.parquet":
        raise ValueError("Unexpected input filename.")
    path = directory / entry["file"]
    if sha256(path) != entry["sha256"]:
        raise ValueError(f"Input checksum changed: {split}.")
    rows = pq.read_table(path, columns=["record_id", "split", "truth_label", "truth_group"]).to_pylist()
    ids = {row["record_id"] for row in rows}
    if (not rows or len(rows) != entry["rows"] or len(ids) != len(rows)
            or any(not isinstance(identifier, str) or not identifier for identifier in ids)):
        raise ValueError(f"Input {split} rows are missing or have invalid or duplicated record IDs.")
    if any(row["split"] != split or not (
        row["truth_label"] == 0 and row["truth_group"] == "signal"
        or 161 <= row["truth_label"] <= 187 and row["truth_group"] == "background"
    ) for row in rows):
        raise ValueError(f"Input {split} has invalid split or truth metadata.")
    return ids


def check_inputs(directory):
    """Check the supplied split files before starting a JVM."""
    manifest = _read_raw_manifest(directory)
    observed = set()
    for split, entry in manifest["splits"].items():
        ids = _check_raw_split(directory, split, entry)
        if observed & ids:
            raise ValueError(f"Input {split} record IDs overlap with another split.")
        observed.update(ids)
    return manifest


def _validate_features(features, splits):
    from pyspark.sql import functions as F

    invalid = F.lit(False)
    for name in FEATURE_NAMES:
        invalid = invalid | F.col(name).isNull() | F.isnan(name) | (F.abs(F.col(name)) == float("inf"))
    summaries = features.groupBy("split").agg(
        F.count("*").alias("rows"), F.sum(F.when(invalid, 1).otherwise(0)).alias("invalid"),
        F.sum("particle_count").alias("particles"),
    ).collect()
    for row in summaries:
        if row["invalid"] or row["rows"] != splits[row["split"]]["rows"]:
            raise ValueError(f"Feature validation failed for {row['split']}.")
    LOGGER.info("Feature checks passed: %s", {row["split"]: row["rows"] for row in summaries})


def _write_spark_features(raw_dir, splits, output_dir):
    from pyspark.sql import SparkSession

    spark = (SparkSession.builder.master("local[1]").appName("particle-preprocessing")
             .config("spark.driver.memory", "1g")
             .config("spark.sql.shuffle.partitions", SHUFFLE_PARTITIONS)
             .config("spark.sql.adaptive.coalescePartitions.enabled", "false")
             .config("spark.ui.enabled", "false")
             .getOrCreate())
    try:
        spark.sparkContext.setLogLevel("WARN")
        spark.sparkContext.setJobGroup("particle-preprocessing", "Prepare particle features")
        jets = spark.read.option("mergeSchema", "true").parquet(
            *(str(raw_dir / item["file"]) for item in splits.values()))
        features = build_features(jets)
        _validate_features(features, splits)
        (output_dir / "plan.txt").write_text(features._jdf.queryExecution().toString(), encoding="utf-8")
        features.write.partitionBy("split").parquet(str(output_dir / "spark-output"))
        return execution_counts(spark.sparkContext)
    finally:
        spark.stop()


def _consolidate_splits(output_dir, splits):
    """Give models one portable Parquet file per split, after Spark has stopped."""
    outputs = {}
    spark_output = output_dir / "spark-output"
    for split in splits:
        files = sorted((spark_output / f"split={split}").glob("*.parquet"))
        table = pa.concat_tables([pq.ParquetFile(path).read() for path in files]).sort_by("record_id")
        table = table.append_column("split", pa.array([split] * table.num_rows))
        path = output_dir / f"{split}.parquet"
        pq.write_table(table, path, compression="zstd")
        outputs[split] = {"file": path.name, "rows": table.num_rows, "sha256": sha256(path)}
    shutil.rmtree(spark_output)
    return outputs


def _replace_output(temporary, output_dir):
    """Keep the previous preparation recoverable until its replacement succeeds."""
    previous = output_dir.with_name(f".{output_dir.name}-previous")
    if previous.exists():
        raise ValueError(f"Previous preparation needs recovery: {previous}")
    if output_dir.exists():
        output_dir.rename(previous)
    try:
        temporary.rename(output_dir)
    except BaseException:
        if previous.exists():
            previous.rename(output_dir)
        raise
    if previous.exists():
        shutil.rmtree(previous)


def prepare_data(raw_dir=RAW_DIR, output_dir=PREPROCESSED_DIR):
    """Validate → calculate features → check quality → write reusable split tables."""
    raw_dir, output_dir = Path(raw_dir), Path(output_dir)
    started = time.perf_counter()
    raw = check_inputs(raw_dir)
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=".prepared-", dir=output_dir.parent))
    try:
        counts = _write_spark_features(raw_dir, raw["splits"], temporary)
        outputs = _consolidate_splits(temporary, raw["splits"])
        elapsed = time.perf_counter() - started
        jet_count = sum(item["rows"] for item in outputs.values())
        manifest = {
            "version": 1, "dataset_id": raw["dataset_id"], "raw_manifest_sha256": sha256(raw_dir / "manifest.json"),
            "feature_source_sha256": sha256(ROOT / "src/preprocessing/features.py"), "feature_names": list(FEATURE_NAMES),
            "feature_sets": {key: list(value) for key, value in FEATURE_SETS.items()},
            "created_at": utc_now(), "elapsed_seconds": round(elapsed, 6),
            "jets_per_second": round(jet_count / elapsed, 3),
            "spark": {"master": "local[1]", "shuffle_partitions": SHUFFLE_PARTITIONS, **counts}, "splits": outputs,
        }
        write_json(temporary / "manifest.json", manifest)
        (temporary / ".gitkeep").touch()
        _replace_output(temporary, output_dir)
        history = ROOT / "data/05_analytics/preprocessing" / (manifest["created_at"].replace(":", "-") + ".json")
        write_json(history, manifest)
        LOGGER.info("Prepared %s in %.2fs (%d scheduled tasks, %.1f jets/s)", output_dir,
                    manifest["elapsed_seconds"], counts["scheduled_tasks"], manifest["jets_per_second"])
        return manifest
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)


def main():
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        result = prepare_data()
        print(json.dumps({"prepared": {name: item["rows"] for name, item in result["splits"].items()},
                          "seconds": result["elapsed_seconds"], "jets_per_second": result["jets_per_second"],
                          "scheduled_tasks": result["spark"]["scheduled_tasks"]}, indent=2))
        return 0
    except Exception:
        LOGGER.exception("Preprocessing failed")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
