"""Read prepared splits and verify their integrity before training."""

import json
import logging
from pathlib import Path

import pyarrow.parquet as pq

from common import ROOT, sha256
from predict.benchmark import BENCHMARK_ROWS

LOGGER = logging.getLogger(__name__)
FEATURE_SOURCE_PATH = ROOT / "src/preprocessing/features.py"


def load_prepared(prepared_dir):
    """Refuse stale, overlapping or modified prepared splits before fitting."""
    directory = Path(prepared_dir)
    manifest = json.loads((directory / "manifest.json").read_text())
    if (not isinstance(manifest.get("dataset_id"), str) or not manifest["dataset_id"]
            or manifest.get("feature_source_sha256") != sha256(FEATURE_SOURCE_PATH)
            or set(manifest.get("splits", {})) != {"train", "validation", "test"}):
        raise ValueError("Prepared dataset metadata is incomplete or features.py changed; rerun preprocessing.")
    splits, seen = {}, set()
    for split, entry in manifest["splits"].items():
        filename = entry.get("file")
        if filename != f"{split}.parquet":
            raise ValueError(f"Unexpected prepared split path: {filename}.")
        path = directory / filename
        if sha256(path) != entry["sha256"]:
            raise ValueError(f"Prepared {split} checksum mismatch; rerun preprocessing.")
        rows = pq.read_table(path).to_pylist()
        if not rows or len(rows) != entry["rows"]:
            raise ValueError(f"Prepared {split} row count differs from its manifest.")
        for row in rows:
            identifier, label = row.get("record_id"), row.get("truth_label")
            if not isinstance(identifier, str) or not identifier or identifier in seen:
                raise ValueError("Prepared split record IDs must be nonempty, unique and disjoint.")
            if (row.get("split") != split or isinstance(label, bool) or not isinstance(label, int)
                    or label not in (0, *range(161, 188))
                    or row.get("truth_group") != ("signal" if label == 0 else "background")):
                raise ValueError(f"Prepared {split} has inconsistent split/truth metadata.")
            seen.add(identifier)
        if {row["truth_group"] for row in rows} != {"signal", "background"}:
            raise ValueError(f"Prepared {split} needs both signal and background rows for comparison.")
        splits[split] = rows
    if len(splits["validation"]) < BENCHMARK_ROWS:
        raise ValueError(f"The fixed latency protocol needs at least {BENCHMARK_ROWS} validation jets.")
    LOGGER.info("Verified dataset %s: %s", manifest["dataset_id"], {key: len(rows) for key, rows in splits.items()})
    return manifest, splits

