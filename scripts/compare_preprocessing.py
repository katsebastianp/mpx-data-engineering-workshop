"""Check a pipeline change using two saved outputs, without running Spark again.

Run: docker compose run --rm lab scripts/compare_preprocessing.py \
    data/02_preprocessed_baseline data/02_preprocessed
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Sequence
    from workshop_types import Record

import argparse
import json
import logging
import math
from pathlib import Path

from common import write_json
from postprocessing.compare import load_prepared

LOGGER = logging.getLogger(__name__)


def compare(before_dir: Path, after_dir: Path, allow_added_features: bool = False) -> Record:
    """Check every saved value; optionally permit explicitly added feature columns."""
    before_dir, after_dir = Path(before_dir), Path(after_dir)
    if before_dir.resolve() == after_dir.resolve():
        raise ValueError("Use separate baseline and changed output folders.")
    before, before_rows, _ = load_prepared(before_dir)
    after, after_rows, _ = load_prepared(after_dir)
    keys = ("dataset_id", "raw_manifest_sha256") if allow_added_features else (
        "dataset_id", "raw_manifest_sha256", "feature_source_sha256", "feature_names", "feature_sets")
    for key in keys:
        if before.get(key) != after.get(key):
            raise ValueError(f"{key} changed; this exercise changes task scheduling only.")
    added = set(after["feature_names"]) - set(before["feature_names"])
    if allow_added_features and not set(before["feature_names"]).issubset(after["feature_names"]):
        raise ValueError("Existing feature names were removed; only added features are allowed.")
    counts = {}
    for split in ("train", "validation", "test"):
        original = sorted(before_rows[split], key=lambda row: row["record_id"])
        changed = sorted(after_rows[split], key=lambda row: row["record_id"])
        if allow_added_features:
            changed = [{name: value for name, value in row.items() if name not in added} for row in changed]
        if original != changed:
            raise ValueError(f"Saved {split} values differ: preserve every ID, feature, label and particle array.")
        counts[split] = len(original)
    timings = {}
    for label, manifest in (("before", before), ("after", after)):
        seconds = manifest["elapsed_seconds"]
        if not isinstance(seconds, (int, float)) or not math.isfinite(seconds) or seconds <= 0:
            raise ValueError(f"Invalid recorded elapsed_seconds for {label}.")
        timings[label] = {"seconds": seconds, "shuffle_partitions": manifest["spark"]["shuffle_partitions"],
                          "scheduled_tasks": manifest["spark"]["scheduled_tasks"]}
    result = {"equivalent": not bool(added), "original_values_preserved": True, "added_features": sorted(added),
              "comparison": "Exact original columns, matched by record_id" if added else "Exact values in every column, matched by record_id",
              "dataset_id": before["dataset_id"], "rows": counts, **timings,
              "observed_speedup": round(timings["before"]["seconds"] / timings["after"]["seconds"], 3),
              "timing_note": "One run per version, including Spark startup. Timing is noisy; fewer tasks need not be faster."}
    LOGGER.info("All %d jets preserve original values; scheduled tasks %s → %s", sum(counts.values()),
                timings["before"]["scheduled_tasks"], timings["after"]["scheduled_tasks"])
    return result


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("before_dir", type=Path)
    parser.add_argument("after_dir", type=Path)
    parser.add_argument("--output", type=Path, help="Optionally save the verified comparison as JSON")
    parser.add_argument("--allow-added-features", action="store_true", help="Check original columns while allowing new numeric features")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        result = compare(args.before_dir, args.after_dir, args.allow_added_features)
        if args.output:
            write_json(args.output, result)
        print(json.dumps(result, indent=2))
        return 0
    except (OSError, ValueError, KeyError, TypeError) as error:
        LOGGER.error("Pipeline comparison failed: %s", error)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
