"""Check a pipeline change using two saved outputs, without running Spark again.

Run: docker compose run --rm lab scripts/compare_preprocessing.py \
    data/02_preprocessed_baseline data/02_preprocessed
"""

from __future__ import annotations

import argparse
import json
import logging
import math
from pathlib import Path

from common import write_json
from postprocessing.compare import load_prepared

LOGGER = logging.getLogger(__name__)


def compare(before_dir: Path, after_dir: Path) -> dict:
    """Require the same dataset, feature code and every saved record value."""
    before_dir, after_dir = Path(before_dir), Path(after_dir)
    if before_dir.resolve() == after_dir.resolve():
        raise ValueError("Use separate baseline and changed output folders.")
    before, before_rows, _ = load_prepared(before_dir)
    after, after_rows, _ = load_prepared(after_dir)
    for key in ("dataset_id", "raw_manifest_sha256", "feature_source_sha256", "feature_names", "feature_sets"):
        if before.get(key) != after.get(key):
            raise ValueError(f"{key} changed; this exercise changes task scheduling only.")
    counts = {}
    for split in ("train", "validation", "test"):
        original = sorted(before_rows[split], key=lambda row: row["record_id"])
        changed = sorted(after_rows[split], key=lambda row: row["record_id"])
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
    result = {"equivalent": True, "comparison": "Exact values in every column, matched by record_id",
              "dataset_id": before["dataset_id"], "rows": counts, **timings,
              "observed_speedup": round(timings["before"]["seconds"] / timings["after"]["seconds"], 3),
              "timing_note": "One run per version, including Spark startup. Timing is noisy; fewer tasks need not be faster."}
    LOGGER.info("All %d jets match exactly; scheduled tasks %s → %s", sum(counts.values()),
                timings["before"]["scheduled_tasks"], timings["after"]["scheduled_tasks"])
    return result


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("before_dir", type=Path)
    parser.add_argument("after_dir", type=Path)
    parser.add_argument("--output", type=Path, help="Optionally save the verified comparison as JSON")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        result = compare(args.before_dir, args.after_dir)
        if args.output:
            write_json(args.output, result)
        print(json.dumps(result, indent=2))
        return 0
    except (OSError, ValueError, KeyError, TypeError) as error:
        LOGGER.error("Pipeline comparison failed: %s", error)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
