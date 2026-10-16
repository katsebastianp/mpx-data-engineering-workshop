"""Compare partition settings with fresh Spark processes and exact output checks.

Run: docker compose run --rm --no-deps lab scripts/benchmark_preprocessing.py \
    --before 2048 --after 4
"""

import argparse
import json
import logging
from pathlib import Path
import statistics
import subprocess
import sys
import tempfile

from common import ANALYTICS_DIR, write_json
from preprocessing import pipeline
from scripts.compare_preprocessing import compare

LOGGER = logging.getLogger(__name__)


def run_once(partitions, output):
    """A separate Python process ensures each run includes fresh JVM startup."""
    log_path = output.with_suffix(".log")
    with log_path.open("w") as log:
        subprocess.run([
            sys.executable, str(Path(__file__).resolve()), "--worker", str(partitions),
            "--output", str(output),
        ], stdout=log, stderr=subprocess.STDOUT, check=True)
    return json.loads((output / "manifest.json").read_text())


def benchmark(before, after, repeats, output):
    """Alternate execution order; never overwrite the participant's prepared data."""
    if before < 1 or after < 1 or before == after or repeats < 3:
        raise ValueError("Use two different positive partition counts and at least three repeats.")
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    runs = {"before": [], "after": []}
    reference = None
    for repeat in range(repeats):
        order = ("before", "after") if repeat % 2 == 0 else ("after", "before")
        for label in order:
            folder = output / f"{repeat + 1:02}-{label}"
            partitions = before if label == "before" else after
            manifest = run_once(partitions, folder)
            if manifest["spark"]["shuffle_partitions"] != partitions:
                raise ValueError("The worker did not apply the requested partition count.")
            if reference is None:
                reference = folder
                # Check the first output with the same loader used by compare.
                from postprocessing.compare import load_prepared
                load_prepared(reference)
            else:
                compare(reference, folder)
            runs[label].append({"seconds": manifest["elapsed_seconds"],
                                "scheduled_tasks": manifest["spark"]["scheduled_tasks"],
                                "folder": str(folder)})
            LOGGER.info("%s %d/%d: %.2fs (%d partitions)", label, repeat + 1,
                        repeats, manifest["elapsed_seconds"], partitions)
    medians = {label: statistics.median(run["seconds"] for run in values)
               for label, values in runs.items()}
    result = {
        "dataset_id": manifest["dataset_id"], "equivalent": True,
        "rows": {key: value["rows"] for key, value in manifest["splits"].items()},
        "before_partitions": before, "after_partitions": after,
        "repeats": repeats, "runs": runs, "median_seconds": medians,
        "observed_speedup": round(medians["before"] / medians["after"], 3),
        "time_reduction_percent": round(100 * (1 - medians["after"] / medians["before"]), 1),
        "timing_note": "Fresh Spark processes, alternating order, including startup. Local timings; no guaranteed speedup on other machines.",
    }
    write_json(output / "summary.json", result)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--before", type=int, default=2048)
    parser.add_argument("--after", type=int, default=4)
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--output", type=Path, help="New evidence folder; existing folders are never overwritten")
    parser.add_argument("--worker", type=int, help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        if args.worker is not None:
            if args.worker < 1 or args.output is None:
                raise ValueError("Worker requires a positive partition count and output folder.")
            pipeline.SHUFFLE_PARTITIONS = args.worker
            pipeline.prepare_data(output_dir=args.output)
            return 0
        if args.output is None:
            parent = ANALYTICS_DIR / "preprocessing-benchmarks"
            parent.mkdir(parents=True, exist_ok=True)
            args.output = Path(tempfile.mkdtemp(prefix="partitions-", dir=parent)) / "runs"
        result = benchmark(args.before, args.after, args.repeats, args.output)
        print(json.dumps(result, indent=2))
        LOGGER.info("Evidence: %s", args.output / "summary.json")
        return 0
    except (OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError):
        LOGGER.exception("Benchmark failed; inspect the saved run logs. No speedup claim was produced.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
